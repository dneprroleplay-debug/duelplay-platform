import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(`${process.cwd()}/${p}`, "utf8");

const home = read("app/page.tsx");
const auth = read("components/Common/AuthContext.tsx");
const ratingPage = read("app/rating/page.tsx");

// ---------------------------------------------------------------------------
// 1. Hydration (#418): the first client render must match the server markup.
// ---------------------------------------------------------------------------
assert.match(home, /const \[heroBackground,setHeroBackground\]=useState\("hero-01"\)/, "the hero background starts from the value the server renders");
assert.ok(!home.includes('if(typeof window==="undefined")return "hero-01"'), "the hero no longer branches on window during the first render");
assert.ok(!/useState\(\(\)=>\{[\s\S]{0,220}sessionStorage/.test(home), "no state initializer reads sessionStorage (server/client mismatch)");
assert.match(home, /useEffect\(\(\)=>\{[\s\S]{0,220}window\.sessionStorage\.getItem\(HERO_STORAGE_KEY\)/, "the stored hero is restored after hydration instead");

assert.match(auth, /useState<HeaderUser \| null>\(null\)/, "auth state starts signed-out on both server and first client render");
assert.ok(!/useState<HeaderUser \| null>\(\s*readStoredUser\s*\)/.test(auth), "auth no longer seeds state from sessionStorage during render");
assert.match(auth, /const \[loading, setLoading\] = useState\(true\)/, "auth starts in the loading state the server renders");
assert.match(auth, /const stored = readStoredUser\(\);[\s\S]{0,120}setUser\(stored\)/, "the cached session is applied in a mount effect, after hydration");

// ---------------------------------------------------------------------------
// 2. Homepage bottom block is a compact TOP-3, not a full rating list.
// ---------------------------------------------------------------------------
assert.match(home, /const top=users\.slice\(0,3\)/, "the homepage ranking only materializes three players");
assert.match(home, /top\.map\(\(u,i\)=>/, "the compact block renders the three ranked players");
assert.ok(!home.includes("users.map("), "the homepage never renders the full ranking list");
assert.match(home, /u\.avatarUrl/, "the TOP-3 cards show the player avatar");
assert.match(home, /#\{i\+1\}/, "the TOP-3 cards show the rank position");
assert.match(home, /href="\/rating"/, "the compact block links to the full rating page");
assert.ok(home.indexOf('id="rating"') < home.indexOf("function Ranking"), "the TOP-3 block stays inside the homepage rating section");

// The full rating page remains a complete, paginated list.
assert.match(ratingPage, /rows\.map\(/, "the /rating page still lists every ranked player");
assert.match(ratingPage, /periods\.map\(/, "the /rating page still offers its period filters");

console.log("Hydration (#418) initial-render safety and homepage TOP-3 block: PASS");
