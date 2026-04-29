export interface Env {
  RESEND_API_KEY: string;
  RESEND_AUDIENCE_ID: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '*';
  const headers = corsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers,
    });
  }

  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers,
    });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !EMAIL_REGEX.test(email)) {
    return new Response(JSON.stringify({ error: 'Invalid email address' }), {
      status: 400,
      headers,
    });
  }

  try {
    const res = await fetch('https://api.resend.com/audiences/' + env.RESEND_AUDIENCE_ID + '/contacts', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        unsubscribed: false,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Resend API error:', res.status, err);
      return new Response(JSON.stringify({ error: 'Failed to subscribe. Please try again later.' }), {
        status: 500,
        headers,
      });
    }

    return new Response(JSON.stringify({ message: "You're on the list." }), {
      status: 200,
      headers,
    });
  } catch (err) {
    console.error('Subscription error:', err);
    return new Response(JSON.stringify({ error: 'Failed to subscribe. Please try again later.' }), {
      status: 500,
      headers,
    });
  }
};
