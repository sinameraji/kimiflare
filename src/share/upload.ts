/**
 * Upload a session JSON to the share Worker and return the public URL.
 */
export async function uploadSession(
  workerUrl: string,
  authSecret: string,
  sessionJson: string,
): Promise<{ id: string; url: string }> {
  const url = workerUrl.replace(/\/$/, "");
  const res = await fetch(`${url}/api/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authSecret}`,
    },
    body: sessionJson,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`Share upload failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { id: string; url: string };
  return data;
}
