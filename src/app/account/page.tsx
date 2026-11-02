import { supabaseConfig } from "@/lib/auth";
import { AuthForm } from "@/components/auth-form";
import { PocketMark } from "@/components/artwork";
export const dynamic = "force-dynamic";

export default function Account() {
  const config = supabaseConfig();
  const siteKey = Reflect.get(process.env, "NEXT_PUBLIC_HCAPTCHA_SITEKEY") as string | undefined;
  return <main className="account-page"><a className="brand" href="/" aria-label="Pocket Base home"><PocketMark/><span>pocket<span className="brand-light">base</span></span></a>
    <AuthForm config={config ? { ...config, siteKey } : null}/>
  </main>;
}
