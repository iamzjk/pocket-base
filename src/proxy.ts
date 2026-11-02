import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const url = Reflect.get(process.env, "NEXT_PUBLIC_SUPABASE_URL") as string | undefined;
  const key = Reflect.get(process.env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") as string | undefined;
  let response = NextResponse.next({ request });
  if (!url || !key) return response;
  const client = createServerClient(url, key, { cookies: {
    getAll: () => request.cookies.getAll(),
    setAll: entries => {
      entries.forEach(({ name, value }) => request.cookies.set(name, value));
      response = NextResponse.next({ request });
      entries.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    },
  } });
  await client.auth.getUser();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = { matcher: ["/", "/account", "/library", "/api/:path*"] };
