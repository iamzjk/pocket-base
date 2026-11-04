import { supabaseConfig } from "@/lib/auth";
import { AuthForm } from "@/components/auth-form";
import { PocketMark } from "@/components/artwork";
export const dynamic = "force-dynamic";

export default function Account() {
  const config = supabaseConfig();
  return <main className="account-page"><a className="brand" href="/" aria-label="Pocket Base home"><PocketMark/><span>pocket<span className="brand-light">base</span></span></a>
    <AuthForm config={config}/>
  </main>;
}
