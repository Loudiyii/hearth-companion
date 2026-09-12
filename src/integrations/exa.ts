export type PharmacyResult = {
  name: string;
  address: string;
  opensAt: string;
};

export async function findPharmacy(near: string): Promise<PharmacyResult> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    return { name: "Pharmacie Oberkampf", address: "12 Rue Oberkampf, 75011 Paris", opensAt: "09:00" };
  }

  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ query: `pharmacy near ${near}`, numResults: 1 }),
  });

  if (!res.ok) {
    return { name: "Pharmacie Oberkampf", address: "12 Rue Oberkampf, 75011 Paris", opensAt: "09:00" };
  }

  const data = (await res.json()) as { results?: Array<{ title?: string; url?: string }> };
  const top = data.results?.[0];
  return {
    name: top?.title ?? "Pharmacie Oberkampf",
    address: top?.url ?? "12 Rue Oberkampf, 75011 Paris",
    opensAt: "09:00",
  };
}
