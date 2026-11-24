import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const dates = new Set(["2026-12-18"]);
const encoder = new TextEncoder();

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function cleanName(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function cleanWishlist(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, 300);
}

function codeToBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function randomCode() {
  return codeToBase64Url(crypto.getRandomValues(new Uint8Array(24)));
}

async function accessHash(code: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(code)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index++) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

function randomIndex(max: number) {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buffer = new Uint32Array(1);
  do { crypto.getRandomValues(buffer); } while (buffer[0] >= limit);
  return buffer[0] % max;
}

function shuffledDerangement(ids: string[]) {
  if (ids.length < 2) throw new Error("At least two participants are needed for the draw.");
  // Fisher–Yates gives a uniform permutation; reject permutations with a fixed point.
  for (let attempt = 0; attempt < 10000; attempt++) {
    const recipients = [...ids];
    for (let index = recipients.length - 1; index > 0; index--) {
      const other = randomIndex(index + 1);
      [recipients[index], recipients[other]] = [recipients[other], recipients[index]];
    }
    if (recipients.every((recipient, index) => recipient !== ids[index])) {
      return ids.map((giver_id, index) => ({ giver_id, recipient_id: recipients[index] }));
    }
  }
  throw new Error("Could not make a draw. Please try again.");
}

function failStatus(message: string) {
  if (message === "event-is-closed") return 409;
  if (message === "name-already-joined") return 409;
  if (message === "invalid-code") return 403;
  if (message === "invalid-organizer-code") return 403;
  if (message === "organizer-code-not-configured") return 503;
  if (message === "draw-already-complete") return 409;
  if (message === "date-tie-needs-organizer-choice" || message === "no-votes-yet") return 409;
  if (message === "at-least-two-participants-required") return 409;
  if (message === "invalid-date" || message === "invalid-name" || message === "invalid-wishlist") return 400;
  if (message === "voting-is-closed" || message === "signups-are-closed" || message === "draw-not-ready" || message === "choose-a-date-first") return 409;
  return 500;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "Use a POST request." }, 405);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 12000) return respond({ error: "Request is too large." }, 413);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return respond({ error: "The shared event service is not fully configured." }, 503);
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return respond({ error: "Invalid request." }, 400);
    const action = body.action;

    if (action === "public") {
      const [{ data: event, error: eventError }, { data: participants, error: peopleError }, { data: voteRows, error: votesError }] = await Promise.all([
        db.from("santa_event").select("signups_open,voting_open,selected_date,draw_complete").eq("id", 1).single(),
        db.from("santa_participants").select("name").order("name", { ascending: true }),
        db.from("santa_votes").select("date"),
      ]);
      if (eventError || peopleError || votesError) throw new Error("Could not read shared event status.");
      const votes: Record<string, number> = { "2026-12-04": 0, "2026-12-11": 0 };
      for (const row of voteRows || []) votes[row.date] = (votes[row.date] || 0) + 1;
      return respond({ settings: event, participants: participants || [], votes });
    }

    if (action === "join") {
      const name = cleanName(body.name);
      const wishlist = cleanWishlist(body.wishlist);
      if (!name || name.length > 50) return respond({ error: "Enter a name up to 50 characters." }, 400);
      const { data: event, error: eventError } = await db.from("santa_event").select("signups_open,voting_open,draw_complete").eq("id", 1).single();
      if (eventError) throw new Error("Could not read event settings.");
      if (!event.signups_open || event.draw_complete) throw new Error("event-is-closed");
      const code = randomCode();
      const hash = await accessHash(code);
      const { data, error } = await db.rpc("join_secret_santa", {
        p_name: name,
        p_name_normalized: name.normalize("NFKC").toLocaleLowerCase(),
        p_wishlist: wishlist,
        p_access_hash: hash,
      });
      if (error?.code === "23505") throw new Error("name-already-joined");
      if (error || !data?.[0]) {
        if (error?.message?.includes("event-is-closed")) throw new Error("event-is-closed");
        throw new Error("Could not add your name. Please try again.");
      }
      return respond({ participant: { name: data[0].name }, accessCode: code }, 201);
    }

    if (action === "restore" || action === "vote" || action === "reveal") {
      const code = typeof body.accessCode === "string" ? body.accessCode.trim() : "";
      if (code.length < 30 || code.length > 50) throw new Error("invalid-code");
      const hash = await accessHash(code);
      const { data: person, error } = await db.from("santa_participants").select("id,name").eq("access_hash", hash).maybeSingle();
      if (error) throw new Error("Could not verify your private code.");
      if (!person) throw new Error("invalid-code");

      if (action === "restore") {
        const { data: vote, error: voteError } = await db.from("santa_votes").select("date").eq("participant_id", person.id).maybeSingle();
        if (voteError) throw new Error("Could not load your vote.");
        return respond({ participant: { name: person.name }, vote: vote?.date || "" });
      }

      if (action === "vote") {
        const date = body.date;
        if (!dates.has(date)) return respond({ error: "The class date is Friday, December 18." }, 400);
        const { data: event, error: eventError } = await db.from("santa_event").select("voting_open,draw_complete").eq("id", 1).single();
        if (eventError) throw new Error("Could not read voting settings.");
        if (!event.voting_open || event.draw_complete) throw new Error("voting-is-closed");
        const { error: voteError } = await db.rpc("cast_secret_santa_vote", { p_participant_id: person.id, p_date: date });
        if (voteError) {
          if (voteError.message?.includes("voting-is-closed")) throw new Error("voting-is-closed");
          throw new Error("Could not save your vote.");
        }
        return respond({ vote: date });
      }

      const { data: event, error: eventError } = await db.from("santa_event").select("draw_complete").eq("id", 1).single();
      if (eventError) throw new Error("Could not read draw status.");
      if (!event.draw_complete) throw new Error("draw-not-ready");
      const { data: assignment, error: assignmentError } = await db.from("santa_assignments").select("recipient_id").eq("giver_id", person.id).single();
      if (assignmentError || !assignment) throw new Error("Your recipient is not available yet.");
      const { data: recipient, error: recipientError } = await db.from("santa_participants").select("name,wishlist").eq("id", assignment.recipient_id).single();
      if (recipientError || !recipient) throw new Error("Could not load your recipient.");
      return respond({ recipient: { name: recipient.name, wishlist: recipient.wishlist } });
    }

    if (action === "admin") {
      const supplied = typeof body.organizerCode === "string" ? body.organizerCode : "";
      const { data: eventAuth, error: authError } = await db.from("santa_event").select("organizer_code_hash").eq("id", 1).single();
      if (authError || !eventAuth?.organizer_code_hash) throw new Error("organizer-code-not-configured");
      if (!constantTimeEqual(await accessHash(supplied), eventAuth.organizer_code_hash)) throw new Error("invalid-organizer-code");
      if (body.operation === "settings") {
        const signupsOpen = body.signupsOpen === true;
        const votingOpen = body.votingOpen === true;
        const requestedDate = body.selectedDate || null;
        if (requestedDate && !dates.has(requestedDate)) return respond({ error: "Choose Friday, December 18, 2026." }, 400);
        const { error: updateError } = await db.rpc("update_secret_santa_settings", {
          p_signups_open: signupsOpen,
          p_voting_open: votingOpen,
          p_requested_date: requestedDate,
        });
        if (updateError) {
          const message = updateError.message || "";
          if (message.includes("draw-already-complete")) throw new Error("draw-already-complete");
          if (message.includes("no-votes-yet")) throw new Error("no-votes-yet");
          if (message.includes("date-tie-needs-organizer-choice")) throw new Error("date-tie-needs-organizer-choice");
          throw new Error("Could not save event settings.");
        }
        return await publicResponse(db);
      }

      if (body.operation === "draw") {
        const { data: event, error: eventError } = await db.from("santa_event").select("draw_complete,signups_open,voting_open,selected_date").eq("id", 1).single();
        if (eventError) throw new Error("Could not read event settings.");
        if (event.draw_complete) throw new Error("draw-already-complete");
        if (event.signups_open || event.voting_open) throw new Error("draw-not-ready");
        if (!event.selected_date) throw new Error("choose-a-date-first");
        const { data: people, error: peopleError } = await db.from("santa_participants").select("id").order("id");
        if (peopleError) throw new Error("Could not load the class list.");
        if (!people || people.length < 2) throw new Error("at-least-two-participants-required");
        const pairs = shuffledDerangement(people.map((person) => person.id));
        const { error: drawError } = await db.rpc("complete_secret_santa_draw", { p_pairs: pairs, p_selected_date: event.selected_date });
        if (drawError) {
          if (drawError.message?.includes("draw-already-complete")) throw new Error("draw-already-complete");
          if (drawError.message?.includes("at-least-two-participants-required")) throw new Error("at-least-two-participants-required");
          if (drawError.message?.includes("draw-not-ready")) throw new Error("draw-not-ready");
          if (drawError.message?.includes("choose-a-date-first")) throw new Error("choose-a-date-first");
          throw new Error("Could not safely finalize the draw.");
        }
        return await publicResponse(db);
      }
      return respond({ error: "Unknown organizer action." }, 400);
    }

    return respond({ error: "Unknown action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed.";
    return respond({ error: message }, failStatus(message));
  }
});

async function publicResponse(db: ReturnType<typeof createClient>) {
  const [{ data: event, error: eventError }, { data: participants, error: peopleError }, { data: voteRows, error: votesError }] = await Promise.all([
    db.from("santa_event").select("signups_open,voting_open,selected_date,draw_complete").eq("id", 1).single(),
    db.from("santa_participants").select("name").order("name", { ascending: true }),
    db.from("santa_votes").select("date"),
  ]);
  if (eventError || peopleError || votesError) throw new Error("Could not read shared event status.");
  const votes: Record<string, number> = { "2026-12-04": 0, "2026-12-11": 0 };
  for (const row of voteRows || []) votes[row.date] = (votes[row.date] || 0) + 1;
  return respond({ settings: event, participants: participants || [], votes });
}
