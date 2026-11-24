// Destructive integration smoke test. Use a disposable staging Supabase project only.
// Required environment variables: SECRET_SANTA_API_URL, SECRET_SANTA_ANON_KEY,
// SECRET_SANTA_ORGANIZER_CODE.
const endpoint = process.env.SECRET_SANTA_API_URL;
const anonKey = process.env.SECRET_SANTA_ANON_KEY;
const organizerCode = process.env.SECRET_SANTA_ORGANIZER_CODE;
if (!endpoint || !anonKey || !organizerCode) throw new Error("Set SECRET_SANTA_API_URL, SECRET_SANTA_ANON_KEY, and SECRET_SANTA_ORGANIZER_CODE for a disposable staging project.");

async function call(action, extra = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": anonKey, "Authorization": `Bearer ${anonKey}` },
    body: JSON.stringify({ action, ...extra }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${action} returned ${response.status}: ${data.error || "unknown error"}`);
  return data;
}

const suffix = crypto.randomUUID().slice(0, 8);
await call("admin", { organizerCode, operation: "settings", signupsOpen: true, votingOpen: true, selectedDate: null });
const participants = [];
for (const [index, label] of ["Alex", "Charlie", "Riley"].entries()) {
  const joined = await call("join", { name: `TEST ${label} ${suffix}`, wishlist: `Private test hint ${index} ${suffix}` });
  participants.push({ ...joined.participant, accessCode: joined.accessCode });
}

const dates = ["2026-12-04", "2026-12-11", "2026-12-04"];
await Promise.all(participants.map((person, index) => call("vote", { accessCode: person.accessCode, date: dates[index] })));
await call("admin", { organizerCode, operation: "settings", signupsOpen: false, votingOpen: false, selectedDate: "2026-12-04" });
const publicData = await call("public");
if (JSON.stringify(publicData).includes("Private test hint") || JSON.stringify(publicData).includes("recipient_id")) {
  throw new Error("Privacy failure: public state contained a private hint or recipient id.");
}
await call("admin", { organizerCode, operation: "draw", selectedDate: "2026-12-04" });

const revealed = await Promise.all(participants.map(async (person) => {
  const restored = await call("restore", { accessCode: person.accessCode });
  if (restored.participant.name !== person.name) throw new Error("A code restored the wrong participant.");
  const result = await call("reveal", { accessCode: person.accessCode });
  return { giver: person.name, recipient: result.recipient.name, hint: result.recipient.wishlist };
}));
const recipientNames = revealed.map((item) => item.recipient);
if (new Set(recipientNames).size !== participants.length) throw new Error("The draw assigned a recipient more than once.");
if (revealed.some((item) => item.giver === item.recipient)) throw new Error("The draw assigned someone to themselves.");
if (revealed.some((item) => !item.hint.startsWith("Private test hint"))) throw new Error("A reveal did not return the recipient's private hint.");
console.log(`Staging smoke test passed for ${participants.length} fake participants. The test draw is now complete; discard this project.`);
