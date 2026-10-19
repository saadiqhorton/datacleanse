/**
 * Phone formatting to an E.164-style display: "+1 555-0142", "+1 555-555-0142", "+44 2079460958".
 * Returns null when the value is not a phone number this module can format.
 */

/** Calling code per default-country code. Only countries a user is likely to default to. */
const CALLING_CODE_BY_COUNTRY: Record<string, string> = {
  US: "1",
  CA: "1",
  GB: "44",
  DE: "49",
  FR: "33",
  IN: "91",
  AU: "61",
  NL: "31",
  ES: "34",
  IT: "39",
  BR: "55",
  MX: "52",
  JP: "81",
  IE: "353",
  NZ: "64",
  SG: "65",
  ZA: "27",
  CN: "86",
};

/** International calling codes (1 to 3 digits) used to split "+CC rest". */
const CALLING_CODES = new Set(
  (
    "1 7 20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98 " +
    "211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 238 239 240 241 242 243 244 245 246 247 248 249 250 251 252 253 254 255 256 257 258 260 261 262 263 264 265 266 267 268 269 290 291 297 298 299 " +
    "350 351 352 353 354 355 356 357 358 359 370 371 372 373 374 375 376 377 378 379 380 381 382 383 385 386 387 389 420 421 423 500 501 502 503 504 505 506 507 508 509 590 591 592 593 594 595 596 597 598 599 " +
    "670 672 673 674 675 676 677 678 679 680 681 682 683 685 686 687 688 689 690 691 692 850 852 853 855 856 880 886 960 961 962 963 964 965 966 967 968 970 971 972 973 974 975 976 977 978 979 980 981 982 983 984 985 986 992 993 994 995 996 998"
  ).split(" "),
);

/** " x123", " ext. 45", " extension 7", " #8" at the end of a value. */
const EXTENSION_RE = /\s*(?:ext\.?|extension|x|#)\s*\.?\s*\d*\s*$/i;
/** Only digits and common separators may remain. */
const SEPARATORS_RE = /^[0-9\s().-]*$/;

/** Format a phone number. `defaultCountry` is used when the number has no "+" prefix. */
export function formatPhone(raw: string, defaultCountry: string): string | null {
  let s = raw.trim().replace(EXTENSION_RE, "").trim();
  if (s === "") return null;

  let international = false;
  if (s.startsWith("+")) {
    international = true;
    s = s.slice(1).trim();
  }
  if (!SEPARATORS_RE.test(s)) return null;

  const digits = s.replace(/\D/g, "");
  if (international) return formatInternational(digits);
  if (digits.length >= 10 && digits.startsWith("00")) return formatInternational(digits.slice(2));

  const cc = CALLING_CODE_BY_COUNTRY[defaultCountry.toUpperCase()];
  if (cc === undefined) return null;
  if (cc === "1") return formatNanp(digits);

  let national = digits;
  if (national.length > 8 && national.startsWith("0")) national = national.slice(1);
  if (national.length < 6 || national.length > 12) return null;
  return `+${cc} ${national}`;
}

/** NANP (+1) display for 7 or 10 digits, with an optional leading national "1" on 11. */
function formatNanp(digits: string): string | null {
  let n = digits;
  if (n.length === 11 && n.startsWith("1")) n = n.slice(1);
  if (n.length === 10 || n.length === 7) return nanpDisplay(n);
  return null;
}

function nanpDisplay(n: string): string {
  return n.length === 10
    ? `+1 ${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`
    : `+1 ${n.slice(0, 3)}-${n.slice(3)}`;
}

function formatInternational(digits: string): string | null {
  if (digits.length < 8 || digits.length > 15) return null;
  const cc = callingCodeOf(digits);
  if (cc === null) return null;
  const rest = digits.slice(cc.length);
  if (cc === "1") {
    return rest.length === 10 || rest.length === 7 ? nanpDisplay(rest) : `+1 ${rest}`;
  }
  return `+${cc} ${rest}`;
}

/** Longest calling-code prefix of a digit string. */
function callingCodeOf(digits: string): string | null {
  for (let len = 3; len >= 1; len--) {
    const prefix = digits.slice(0, len);
    if (prefix.length === len && CALLING_CODES.has(prefix)) return prefix;
  }
  return null;
}
