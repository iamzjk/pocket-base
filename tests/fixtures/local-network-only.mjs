// Browser-test server preload: deny any accidental request to a real service.
const originalFetch=globalThis.fetch;
globalThis.fetch=function(input,init) {
  const url=new URL(typeof input==="string" ? input : input instanceof URL ? input.href : input.url);
  if(!["127.0.0.1","localhost","[::1]"].includes(url.hostname))
    throw new Error("Browser tests may only contact local test services.");
  return originalFetch(input,init);
};
