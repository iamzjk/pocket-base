"use client";

import { useEffect, useRef, useState } from "react";

type Captcha = { render(container: HTMLElement, options: Record<string, unknown>): string; remove(id: string): void };
declare global { interface Window { hcaptcha?: Captcha; pocketCaptchaReady?: () => void } }
let loading: Promise<Captcha> | undefined;
function loadCaptcha() {
  if (window.hcaptcha) return Promise.resolve(window.hcaptcha);
  if (!loading) loading = new Promise<Captcha>((resolve, reject) => {
    const script = document.createElement("script");
    let timer: ReturnType<typeof setTimeout>;
    const fail = () => { clearTimeout(timer); delete window.pocketCaptchaReady; script.remove(); loading = undefined; reject(new Error("Security check unavailable")); };
    window.pocketCaptchaReady = () => { clearTimeout(timer); delete window.pocketCaptchaReady; if (window.hcaptcha) resolve(window.hcaptcha); else fail(); };
    script.src = "https://js.hcaptcha.com/1/api.js?onload=pocketCaptchaReady&render=explicit&recaptchacompat=off";
    script.async = true; script.onerror = fail;
    timer = setTimeout(fail, 20_000);
    document.head.appendChild(script);
  });
  return loading;
}

export function CaptchaCheck({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let api: Captcha | undefined;
    let id: string | undefined;
    setError(false); onToken("");
    loadCaptcha().then(value => {
      if (cancelled || !container.current) return;
      api = value;
      id = api.render(container.current, { sitekey: siteKey, size: "compact", callback: onToken,
        "expired-callback": () => onToken(""), "chalexpired-callback": () => onToken(""),
        "error-callback": () => { onToken(""); setError(true); } });
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; if (id !== undefined) api?.remove(id); };
  }, [siteKey, onToken, retry]);
  return <div className="captcha-check"><div ref={container}/>{error && <p role="alert">The security check couldn’t load. <button type="button" className="text-button" onClick={() => setRetry(n => n+1)}>Try again</button></p>}</div>;
}
