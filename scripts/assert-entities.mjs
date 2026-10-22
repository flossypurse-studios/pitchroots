// Tiny script-level check for supabase/functions/poll/entities.mjs — this repo has
// no test runner configured, so `node scripts/assert-entities.mjs` is it.
import assert from "node:assert/strict";
import { decodeEntities } from "../supabase/functions/poll/entities.mjs";

// The actual production bug: hex numeric references (Montr&#xe9;al) rendered
// literally because the old stripHtml() only stripped decimal ones.
assert.equal(decodeEntities("CF Montr&#xe9;al vs. New England Revolution"), "CF Montréal vs. New England Revolution");
assert.equal(decodeEntities("Alexis S&#xe1;nchez"), "Alexis Sánchez");
// Decimal numeric references, the ones the old code stripped instead of decoding.
assert.equal(decodeEntities("Montr&#233;al"), "Montréal");
assert.equal(decodeEntities("RCMP&#8217;s release"), "RCMP’s release");
// The named entities a feed actually uses.
assert.equal(decodeEntities("Tom &amp; Jerry &lt;3 &quot;cats&quot; &apos;n&apos; dogs&nbsp;"), "Tom & Jerry <3 \"cats\" 'n' dogs ");
// Never double-decodes: "&amp;lt;" is literal text "&lt;", not "<".
assert.equal(decodeEntities("&amp;lt;script&amp;gt;"), "&lt;script&gt;");
// Unrecognized named references are left exactly as written, never dropped.
assert.equal(decodeEntities("&unknown;"), "&unknown;");
// No entities at all — passes through unchanged.
assert.equal(decodeEntities("no entities here"), "no entities here");

console.log("entities.mjs: all assertions passed");
