import type { Theme } from "@/lib/types";
export function PocketMark() {
  return <svg viewBox="0 0 38 42" fill="none" aria-hidden="true"><path d="M5 7h28v16c0 8-6 13-14 16C11 36 5 31 5 23V7Z" fill="currentColor"/><path d="M12 15h14M12 21h8" stroke="white" strokeWidth="3" strokeLinecap="round"/><path d="m30 1 1.8 4.2L36 7l-4.2 1.8L30 13l-1.8-4.2L24 7l4.2-1.8L30 1Z" fill="#d4ee8b"/></svg>;
}
export function GameArtwork({ theme, title = "" }: { theme: Theme; title?: string }) {
  return <svg viewBox="0 0 320 220" fill="none" role="img" aria-label={title || "Game illustration"} className={"game-art art-" + theme}>
    {theme === "cosmic" && <>
      <circle cx="69" cy="50" r="3" fill="#f8edba"/><circle cx="270" cy="143" r="3" fill="#f8edba"/>
      <circle cx="231" cy="42" r="2" fill="#f8edba"/><path d="m252 67 6 15 16 6-16 6-6 16-6-16-15-6 15-6 6-15ZM69 130l4 9 10 4-10 4-4 10-4-10-9-4 9-4 4-9Z" fill="#eee0a8"/>
      <ellipse cx="157" cy="186" rx="64" ry="10" fill="#594084" opacity=".22"/>
      <g transform="rotate(25 158 108)"><path d="M137 142h42l-6 31-15-13-15 13-6-31Z" fill="#e6ef99"/><path d="M129 109c-14 10-19 27-16 45l23-10M187 109c14 10 19 27 16 45l-23-10" fill="#bf9be8"/><path d="M158 33c-27 24-35 66-26 106h52c9-40 1-82-26-106Z" fill="#faf3e8"/><path d="M158 33c-10 9-17 20-22 33h44c-5-13-12-24-22-33Z" fill="#e4c9f8"/><circle cx="158" cy="94" r="17" fill="#7853ae"/><circle cx="153" cy="89" r="6" fill="#b6d9cd"/><path d="M142 139h32" stroke="#63457e" strokeWidth="5" strokeLinecap="round"/></g>
    </>}
    {theme === "mint" && <>
      <g transform="rotate(-13 113 105)"><rect x="62" y="45" width="94" height="124" rx="17" fill="#fcf7e9"/><path d="M90 91c12-14 42-13 41 9-1 24-23 42-23 42s-27-24-25-40c0-4 3-8 7-11Z" fill="#ef8f9c"/><path d="M100 88c-8-14 7-19 10-22-1 10 10 9 14 16-10 6-17-2-24 6Z" fill="#599b72"/><path d="m98 106 3 3m16-4 3 3m-10 13 3 3" stroke="#ffeed8" strokeWidth="3" strokeLinecap="round"/></g>
      <g transform="rotate(12 211 121)"><rect x="164" y="59" width="94" height="124" rx="17" fill="#d9eddc"/><path d="m210 91 6 16 18 1-14 11 5 17-15-10-15 10 5-17-14-11 18-1 6-16Z" fill="#72ad94"/></g><path d="m270 45 4 10 10 4-10 4-4 10-4-10-10-4 10-4 4-10Z" fill="#5e9b82"/>
    </>}
    {theme === "lemon" && <>
      <rect x="80" y="33" width="163" height="163" rx="17" fill="#f9f8d7"/>
      <path d="M102 56h116v34h-38v30h38v49h-42v-25h-36v28h-38v-58h37V87h-37V56Z" stroke="#9ea94c" strokeWidth="13" strokeLinejoin="round"/>
      <circle cx="105" cy="57" r="12" fill="#c6ce68"/><ellipse cx="211" cy="171" rx="17" ry="14" fill="#abd9b7"/><circle cx="205" cy="165" r="3" fill="#3b6651"/><circle cx="217" cy="165" r="3" fill="#3b6651"/><path d="M206 174q5 5 10 0" stroke="#3b6651" strokeWidth="2" strokeLinecap="round"/><path d="m57 119 5 12 13 5-13 5-5 13-5-13-12-5 12-5 5-12Z" fill="#adbc62"/>
    </>}
    {theme === "lilac" && <>
      <circle cx="161" cy="111" r="66" fill="#e4d9f6"/><path d="M146 84c0-23 43-25 43 0 0 17-28 18-28 36" stroke="#8260b3" strokeWidth="16" strokeLinecap="round"/><circle cx="161" cy="143" r="9" fill="#8260b3"/>
      <path d="m67 58 6 14 15 6-15 6-6 15-6-15-14-6 14-6 6-14Z" fill="#f9e8a4"/><circle cx="254" cy="151" r="11" fill="#9d79cc"/><circle cx="249" cy="50" r="5" fill="#a9cbbb"/><path d="m83 167 8 8m-8 0 8-8" stroke="#a489bf" strokeWidth="4" strokeLinecap="round"/>
    </>}
    {theme === "peach" && <>
      <rect x="82" y="38" width="157" height="148" rx="15" fill="#fff5e4" transform="rotate(-5 160 110)"/>
      <path d="M106 133q-1-59 25-45t15 49q-1-59 24-41t21 29q21-31 27-10" stroke="#d1a5e1" strokeWidth="13" strokeLinecap="round"/>
      <path d="m192 148 62-86 15 12-64 86-19 9 6-21Z" fill="#e8a461"/><path d="m192 148 13 12-19 9 6-21Z" fill="#76504a"/><path d="m250 68 9-12q7-4 12 4l3 5-9 13-15-10Z" fill="#d2849c"/><circle cx="68" cy="76" r="7" fill="#d79078"/><path d="m260 158 5 12 12 5-12 5-5 12-5-12-12-5 12-5 5-12Z" fill="#e8c274"/>
    </>}
  </svg>;
}
