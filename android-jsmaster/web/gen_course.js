#!/usr/bin/env node
/**
 * gen_course.js — builds the JS Mastery course data.
 *
 *   node web/gen_course.js [outDir]   (default: app/src/main/assets/www/data)
 *
 * Writes:
 *   data/topics.json     index: 50 topics with lesson HTML + 8 quiz questions
 *   data/p/<id>.json     105 practice problems per topic (5,250 total)
 *
 * Practice shape: { id, prompt, starter, test, hint, solution }
 *   - `starter` is pre-filled editor code; the learner edits it.
 *   - `test` is a JS expression evaluated after the learner's code in a
 *     sandboxed iframe; truthy (or a promise resolving truthy) = pass.
 * Deterministic (seeded) so CI builds are reproducible. Exits non-zero on
 * any invalid record, so a broken course can never ship.
 */
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || path.join(HERE, '..', 'app', 'src', 'main', 'assets', 'www', 'data');

// ------------------------------------------------------------- seeded PRNG
function RNG(seed) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    },
  };
}
const N_PRACTICE = 105; // per topic -> 50 * 105 = 5,250 practices

// ------------------------------------------------------- practice builders
// Convention: every practice is { prompt, starter, test, hint, solution }.
// `starter` = setup lines + a TODO comment; `solution` = setup + working code
// (self-contained: the app runs editor content alone, then the test).
function mk(prompt, setup, body, test, hint) {
  setup = (setup || '').trim();
  const nl = setup ? '\n' : '';
  return {
    prompt,
    starter: setup + nl + '// TODO: write your code here',
    solution: setup + nl + body,
    test,
    hint: hint || body,
  };
}
function logPractice(msg) {
  return mk(`Use console.log to print exactly: ${JSON.stringify(msg)}`, '',
    `console.log(${JSON.stringify(msg)});`, `__logs.length === 1 && __logs[0] === ${JSON.stringify(msg)}`);
}
function assignPractice(varName, value, desc) {
  const jsVal = JSON.stringify(value);
  return mk(`Declare a variable \`${varName}\` and assign it ${desc || `the value ${jsVal}`}.`, '',
    `let ${varName} = ${jsVal};`, `${varName} === ${jsVal}`);
}
function jsLiteral(v) { return typeof v === 'bigint' ? v.toString() + 'n' : JSON.stringify(v); }
function typeofPractice(value) {
  const t = value === null ? 'object' : typeof value;
  const lit = jsLiteral(value);
  return mk(`Store the result of \`typeof ${lit}\` in a variable \`t\`.`, '',
    `let t = typeof ${lit};`, `t === ${JSON.stringify(t)}`);
}
function mathPractice(a, op, b) {
  const e = op === '**' ? Math.min(b, 6) : b; // keep powers small & identical everywhere
  const val = { '+': a + b, '-': a - b, '*': a * b, '/': b === 0 ? null : a / b, '%': b === 0 ? null : a % b, '**': a ** e }[op];
  if (val === null || !Number.isFinite(val)) return mathPractice(a, '+', b);
  const shown = op === '**' ? `a ** ${e}` : `a ${op} b`;
  return mk(`Given \`a = ${a}\` and \`b = ${b}\`, compute \`${shown}\` and store the result in \`result\`.`,
    `let a = ${a}, b = ${b};`, `let result = ${shown};`, `result === ${JSON.stringify(val)}`);
}
function boolPractice(a, op, b) {
  const val = { '>': a > b, '<': a < b, '>=': a >= b, '<=': a <= b, '===': a === b, '!==': a !== b, '&&': a && b, '||': a || b }[op];
  return mk(`Given \`a = ${JSON.stringify(a)}\` and \`b = ${JSON.stringify(b)}\`, store the result of \`a ${op} b\` in \`r\`.`,
    `let a = ${JSON.stringify(a)}, b = ${JSON.stringify(b)};`, `let r = a ${op} b;`, `r === ${JSON.stringify(val)}`);
}
function strPractice(kind, s) {
  const S = JSON.stringify(s);
  const tasks = {
    length: [`Store the length of ${S} in \`len\`.`, `let len = ${S}.length;`, `len === ${s.length}`],
    upper: [`Store the UPPERCASE version of ${S} in \`u\`.`, `let u = ${S}.toUpperCase();`, `u === ${JSON.stringify(s.toUpperCase())}`],
    concat: [`Store ${S} + "!" in \`out\`.`, `let out = ${S} + "!";`, `out === ${JSON.stringify(s + '!')}`],
    slice: [`Store the first 3 characters of ${S} in \`part\`.`, `let part = ${S}.slice(0, 3);`, `part === ${JSON.stringify(s.slice(0, 3))}`],
    indexOf: [`Store the index of "a" in ${S} in \`i\` (use indexOf).`, `let i = ${S}.indexOf("a");`, `i === ${s.indexOf('a')}`],
    trim: [`Store the trimmed version of ${JSON.stringify('  ' + s + '  ')} in \`t\`.`, `let t = ${JSON.stringify('  ' + s + '  ')}.trim();`, `t === ${JSON.stringify(s)}`],
  };
  const [prompt, body, test] = tasks[kind];
  return mk(prompt, '', body, test);
}
function loopPractice(kind, n) {
  if (kind === 'sum') {
    const sum = (n * (n + 1)) / 2;
    return mk(`Use a for loop to compute the sum of 1..${n} and store it in \`sum\`.`,
      'let sum = 0;', `for (let i = 1; i <= ${n}; i++) sum += i;`, `sum === ${sum}`);
  }
  if (kind === 'fact') {
    const f = (k) => (k <= 1 ? 1 : k * f(k - 1));
    return mk(`Use a loop to compute ${n}! (factorial) and store it in \`fact\`.`,
      'let fact = 1;', `for (let i = 2; i <= ${n}; i++) fact *= i;`, `fact === ${f(n)}`);
  }
  return mk(`Use a loop to build a string of ${n} "*" characters in \`stars\`.`,
    'let stars = "";', `for (let i = 0; i < ${n}; i++) stars += "*";`, `stars === ${JSON.stringify('*'.repeat(n))}`);
}
function arrPractice(kind, vals) {
  const arr = JSON.stringify(vals);
  if (kind === 'build') {
    return mk(`Create an array \`arr\` containing exactly: ${arr}`, '', `let arr = ${arr};`, `JSON.stringify(arr) === ${JSON.stringify(arr)}`);
  }
  if (kind === 'push') {
    return mk(`Start with \`arr = ${JSON.stringify(vals.slice(0, -1))}\`, then push ${JSON.stringify(vals[vals.length - 1])} so that arr equals ${arr}.`,
      `let arr = ${JSON.stringify(vals.slice(0, -1))};`, `arr.push(${JSON.stringify(vals[vals.length - 1])});`, `JSON.stringify(arr) === ${JSON.stringify(arr)}`);
  }
  const k = vals.length - 1;
  return mk(`Given \`arr = ${arr}\`, store \`arr[${k}]\` in \`last\`.`,
    `let arr = ${arr};`, `let last = arr[${k}];`, `last === ${JSON.stringify(vals[k])}`);
}
function arrMethodPractice(kind, arr, arg) {
  const a = JSON.stringify(arr);
  const map = {
    join: [`Given \`arr = ${a}\`, store \`arr.join("-")\` in \`out\`.`, `out = arr.join("-");`, `out === ${JSON.stringify(arr.join('-'))}`],
    includes: [`Given \`arr = ${a}\`, store \`arr.includes(${JSON.stringify(arg)})\` in \`out\`.`, `out = arr.includes(${JSON.stringify(arg)});`, `out === ${arr.includes(arg)}`],
    indexOf: [`Given \`arr = ${a}\`, store \`arr.indexOf(${JSON.stringify(arg)})\` in \`out\`.`, `out = arr.indexOf(${JSON.stringify(arg)});`, `out === ${arr.indexOf(arg)}`],
    slice: [`Given \`arr = ${a}\`, store \`arr.slice(1, 3)\` in \`out\`.`, `out = arr.slice(1, 3);`, `JSON.stringify(out) === ${JSON.stringify(JSON.stringify(arr.slice(1, 3)))}`],
  };
  const [prompt, body, test] = map[kind];
  return mk(prompt, `let arr = ${a};`, `let out;\n${body}`, test);
}
function objPractice(kind, obj) {
  const o = JSON.stringify(obj);
  if (kind === 'create') {
    return mk(`Create an object \`user\` with these properties: ${o}`, '', `let user = ${o};`, `JSON.stringify(user) === ${JSON.stringify(o)}`);
  }
  const key = Object.keys(obj)[0];
  return mk(`Given \`user = ${o}\`, store \`user.${key}\` in \`v\`.`,
    `let user = ${o};`, `let v = user.${key};`, `v === ${JSON.stringify(obj[key])}`);
}
function tmplPractice(a, b) {
  const s = `${a} loves ${b}`;
  return mk(`Use a template literal to build ${JSON.stringify(s)} from \`a = ${JSON.stringify(a)}\` and \`b = ${JSON.stringify(b)}\`; store it in \`msg\`.`,
    `let a = ${JSON.stringify(a)}, b = ${JSON.stringify(b)};`, 'let msg = `${a} loves ${b}`;', `msg === ${JSON.stringify(s)}`);
}
function coercePractice(expr, val) {
  return mk(`Store the result of \`${expr}\` in \`r\`. What does JavaScript actually produce?`, '',
    `let r = ${expr};`, `r === ${JSON.stringify(val)}`);
}
function datePractice(y, mo, d) {
  const dt = new Date(y, mo, d);
  const kind = ['getFullYear()', 'getMonth()', 'getDate()', 'getDay()'][Math.abs(y + mo + d) % 4];
  const val = dt[kind.replace('()', '')]();
  return mk(`Given \`const dt = new Date(${y}, ${mo}, ${d})\`, store \`dt.${kind}\` in \`v\`.`,
    `const dt = new Date(${y}, ${mo}, ${d});`, `let v = dt.${kind};`, `v === ${val}`);
}
function jsonPractice(obj) {
  return mk(`Store \`JSON.stringify(obj)\` in \`s\` where \`obj = ${JSON.stringify(obj)}\`.`,
    `let obj = ${JSON.stringify(obj)};`, `let s = JSON.stringify(obj);`, `s === ${JSON.stringify(JSON.stringify(obj))}`);
}
function regexPractice(pattern, str, expect) {
  return mk(`Store the result of \`new RegExp(${JSON.stringify(pattern)}).test(${JSON.stringify(str)})\` in \`ok\`.`, '',
    `let ok = /${pattern}/.test(${JSON.stringify(str)});`, `ok === ${expect}`);
}
function conceptPractice(q, ans) {
  return mk(`${q} Store your answer (as a string) in \`ans\`.`, '', `let ans = ${JSON.stringify(ans)};`, `ans === ${JSON.stringify(ans)}`);
}
function domPractice(text) {
  return mk(`Set the text of the element with id "out" to ${JSON.stringify(text)} using textContent.`,
    '', `document.getElementById("out").textContent = ${JSON.stringify(text)};`,
    `document.getElementById("out").textContent === ${JSON.stringify(text)}`);
}
function asyncPractice(val) {
  return mk(`Create a Promise that resolves to ${JSON.stringify(val)} and store it in \`p\`.`, '',
    `let p = Promise.resolve(${JSON.stringify(val)});`, `(async () => (await p) === ${JSON.stringify(val)})()`);
}

// ------------------------------------------------------------- topic table
// quiz entries: [question, correctAnswer, [wrong1, wrong2, wrong3]]
const TOPICS = [
// ---------------- BEGINNER 1-18 ----------------
{ id:'welcome', n:1, level:'Beginner', title:'Welcome to JavaScript',
  points:['JavaScript runs in every web browser and powers interactive apps.','console.log(...) prints values to the console — your main debugging tool.','Statements end with a semicolon (optional but recommended).','This course runs 100% offline inside this app.'],
  steps:['Open the Playground tab.','Type console.log("Hello");','Press Run and watch the output panel.'],
  example:'console.log("Hello, world!");\nconsole.log(2 + 2);',
  quiz:[
    ['What does console.log("hi") do?','Prints "hi" to the console',['Deletes the code','Opens a file','Restarts the browser']],
    ['How do you write a comment in JS?','// like this',['<!-- like this -->','# like this','** like this **']],
    ['What symbol ends a statement?','; (semicolon)',[': (colon)',', (comma)','. (dot)']],
    ['Where does JavaScript run?','In the browser (and servers like Node.js)',['Only in Word','Only in Excel','Only on TVs']],
    ['What prints the number 42?','console.log(42)',['print(42)','echo 42','show(42)']],
    ['Is this app online or offline?','Offline — everything is bundled',['Needs WiFi','Needs 5G','Needs a server']],
    ['What is the output of console.log(2 + 2)?','4',['22','"2 + 2"','error']],
    ['Which key opens the browser console?','F12 (or Ctrl+Shift+I)',['F1','Esc','Tab']],
  ],
  gen: { kind:'log' } },
{ id:'variables', n:2, level:'Beginner', title:'Variables: let, const, var',
  points:['let declares a changeable variable.','const declares a constant — it cannot be reassigned.','var is the old way; avoid it in modern code.','Names can contain letters, digits, _ and $ (not start with a digit).'],
  steps:['Declare let x = 5;','Change it: x = 10;','Try reassigning a const — you get an error.'],
  example:'let name = "Amara";\nconst PI = 3.14159;\nname = "John"; // ok\n// PI = 3;     // TypeError!',
  quiz:[
    ['Which keyword declares a constant?','const',['let','var','final']],
    ['What happens if you reassign a const?','TypeError',['Nothing','It changes','It becomes a let']],
    ['Which is the modern way to declare a variable?','let',['var','dim','declare']],
    ['Is `let 1x = 5;` valid?','No — names cannot start with a digit',['Yes','Only in strict mode','Only for const']],
    ['What is the value of x after: let x = 1; x = x + 2;','3',['1','2','"1+2"']],
    ['Can you declare the same let variable twice?','No — SyntaxError',['Yes, it updates','Only in a loop','Only globally']],
    ['What does `let x;` give x?','undefined',['null','0','"undefined"']],
    ['Which keyword is block-scoped?','let and const (var is function-scoped)',['Only var','Only const','None']],
  ],
  gen: { kind:'assign' } },
{ id:'data-types', n:3, level:'Beginner', title:'Data Types',
  points:['string (text), number, boolean, null, undefined, symbol, bigint.','Use typeof to check a value\'s type.','null means "no value"; undefined means "not set yet".'],
  steps:['Try typeof 42, typeof "hi", typeof true.','Notice typeof null returns "object" (a famous quirk!).'],
  example:'typeof 42;        // "number"\ntypeof "hi";      // "string"\ntypeof true;      // "boolean"\ntypeof null;      // "object" (quirk!)\ntypeof undefined; // "undefined"',
  quiz:[
    ['typeof "hello" is?','"string"',['"text"','"char"','"object"']],
    ['typeof 42 is?','"number"',['"int"','"digit"','"float"']],
    ['typeof true is?','"boolean"',['"bool"','"logic"','"binary"']],
    ['typeof null is?','"object" (a known quirk)',['"null"','"undefined"','"none"']],
    ['typeof undefined is?','"undefined"',['"null"','"void"','"nothing"']],
    ['How many primitive types does JS have?','7',['5','3','10']],
    ['Is null equal to undefined with ==?','Yes (loose equality)',['No','Only with ===','Never']],
    ['What type is 10n?','bigint',['number','symbol','huge']],
  ],
  gen: { kind:'typeof' } },
{ id:'numbers', n:4, level:'Beginner', title:'Numbers & Math',
  points:['All numbers are floating point: 0.1 + 0.2 !== 0.3 exactly.','Use Math.round, Math.floor, Math.ceil, Math.random().','Infinity and NaN are special number values.'],
  steps:['Compute 7 * 8 and store it.','Try Math.floor(3.7) and Math.ceil(3.2).'],
  example:'Math.round(3.5);   // 4\nMath.floor(3.9);   // 3\nMath.max(2, 9);    // 9\nMath.pow(2, 10);   // 1024\nNumber("42") + 1;  // 43',
  quiz:[
    ['What is 7 * 8?','56',['54','48','64']],
    ['Math.floor(3.9) is?','3',['4','3.9','error']],
    ['Math.ceil(3.1) is?','4',['3','3.1','error']],
    ['What is 10 / 4?','2.5',['2','3','error']],
    ['0.1 + 0.2 === 0.3?','false (floating point)',['true','error','undefined']],
    ['What does Math.pow(2, 3) return?','8',['6','9','23']],
    ['What is 10 % 3?','1',['3','0','10']],
    ['Number("abc") is?','NaN',['undefined','0','error thrown']],
  ],
  gen: { kind:'math' } },
{ id:'strings', n:5, level:'Beginner', title:'Strings',
  points:['Strings are text in quotes: "hi" or \'hi\' or `hi`.','Use .length to get the number of characters.','Concatenate with + or template literals.'],
  steps:['Find the length of "Monrovia".','Uppercase a string with .toUpperCase().','Slice the first 3 letters.'],
  example:'"Monrovia".length;          // 8\n"hi" + " there";             // "hi there"\n"Liberia".toUpperCase();     // "LIBERIA"\n"hello".slice(0, 3);         // "hel"\n"abc".indexOf("b");          // 1',
  quiz:[
    ['"abc".length is?','3',['2','4','undefined']],
    ['"hi" + "yo" is?','"hiyo"',['"hi yo"','error','"hiyo" with space']],
    ['"Liberia".toUpperCase() is?','"LIBERIA"',['"liberia"','"Liberia"','error']],
    ['"hello".slice(1, 3) is?','"el"',['"he"','"ell"','"el "']],
    ['"abc".indexOf("c") is?','2',['3','1','-1']],
    ['Which quote allows ${} interpolation?','Backticks `',['Double quotes','Single quotes','None']],
    ['" a ".trim() is?','"a"',['" a "','"a "','error']],
    ['Can strings use single quotes?','Yes',['No','Only in old JS','Only for one char']],
  ],
  gen: { kind:'str' } },
{ id:'operators', n:6, level:'Beginner', title:'Operators',
  points:['Arithmetic: + - * / % ** (power).','% is the remainder (modulo).','+ also concatenates strings.'],
  steps:['Compute a + b for given values.','Try 2 ** 10 (1024).','Use % to check even/odd.'],
  example:'10 % 3;      // 1\n2 ** 10;     // 1024\n"a" + 1;     // "a1"\n5 + "2";     // "52" (string!)\n5 - "2";     // 3 (number)',
  quiz:[
    ['What is 2 ** 3?','8',['6','9','5']],
    ['What is 17 % 5?','2',['3','5','0']],
    ['"5" + 3 is?','"53" (string)',['8','"5 3"','error']],
    ['5 - "2" is?','3 (number)',['"52"','NaN','error']],
    ['What operator is power?','**',['^','pow','%%']],
    ['10 / 4 is?','2.5',['2','2.4','error']],
    ['What does ++ do?','Adds 1',['Subtracts 1','Squares','Doubles']],
    ['x += 5 is the same as?','x = x + 5',['x = 5','x + 5','x * 5']],
  ],
  gen: { kind:'boolmath' } },
{ id:'comparison', n:7, level:'Beginner', title:'Comparison & Logic',
  points:['Comparison: == === != !== > < >= <=.','=== compares value AND type (use this!).','Logic: && (and), || (or), ! (not).'],
  steps:['Compare two numbers with >.','Combine conditions with &&.','Negate a boolean with !.'],
  example:'5 > 3;        // true\n"5" === 5;   // false (different types)\n"5" == 5;    // true (loose)\ntrue && false; // false\n!true;       // false',
  quiz:[
    ['"5" === 5 is?','false',['true','error','undefined']],
    ['"5" == 5 is?','true',['false','error','NaN']],
    ['true && false is?','false',['true','null','error']],
    ['true || false is?','true',['false','null','error']],
    ['!true is?','false',['true','null','error']],
    ['5 >= 5 is?','true',['false','error','undefined']],
    ['Which is strict equality?','===',['==','!=','=>']],
    ['2 < 1 || 3 > 2 is?','true',['false','error','NaN']],
  ],
  gen: { kind:'bool' } },
{ id:'if-else', n:8, level:'Beginner', title:'if / else',
  points:['if (cond) { ... } runs when cond is truthy.','else if chains more conditions; else is the fallback.','Any value can be a condition: 0, "", null, undefined are falsy.'],
  steps:['Write a function that returns "even" or "odd".','Add an else-if branch for negative numbers.'],
  example:'function grade(score) {\n  if (score >= 70) return "A";\n  else if (score >= 50) return "B";\n  else return "C";\n}',
  quiz:[
    ['if (0) { } runs?','Never (0 is falsy)',['Always','Only at night','Randomly']],
    ['if ("") { } runs?','Never (empty string is falsy)',['Always','Sometimes','Error']],
    ['if ("hi") { } runs?','Yes (non-empty string is truthy)',['Never','Error','Randomly']],
    ['else if is used for?','Extra conditions',['Loops','Objects','Classes']],
    ['What is the fallback branch called?','else',['final','default branch','catch']],
    ['if (null) runs?','Never',['Always','Error','Once']],
    ['Can you chain else if many times?','Yes',['No','Max 2','Only with var']],
    ['if (!true) runs?','Never (negation)',['Always','Error','Randomly']],
  ],
  gen: { kind:'ifFn' } },
{ id:'loops-for', n:9, level:'Beginner', title:'for Loops',
  points:['for (let i = 0; i < n; i++) { ... } repeats n times.','i++ increases i by 1 each iteration.','break exits the loop; continue skips to the next iteration.'],
  steps:['Sum the numbers 1..10 with a loop.','Build a string of stars.','Use break when a condition is met.'],
  example:'for (let i = 0; i < 3; i++) {\n  console.log(i); // 0 1 2\n}\nlet sum = 0;\nfor (let i = 1; i <= 10; i++) sum += i; // 55',
  quiz:[
    ['How many times does for (let i = 0; i < 3; i++) run?','3',['2','4','infinite']],
    ['What does i++ do?','i = i + 1',['i = i - 1','i = i * 2','nothing']],
    ['What does break do?','Exits the loop',['Skips one iteration','Restarts the loop','Error']],
    ['What does continue do?','Skips to next iteration',['Exits the loop','Restarts','Error']],
    ['for (let i = 5; i < 5; i++) runs?','0 times',['5 times','infinite','error']],
    ['Sum 1..4 with a loop is?','10',['9','11','4']],
    ['Can the loop variable be const?','No (it changes)',['Yes','Only i','Only 0']],
    ['What is i after the loop for (let i = 0; i < 3; i++)?','3',['2','0','undefined']],
  ],
  gen: { kind:'loop' } },
{ id:'loops-while', n:10, level:'Beginner', title:'while & do-while',
  points:['while (cond) { ... } repeats while cond is true.','Be careful: if cond never becomes false you get an infinite loop!','do { ... } while (cond) runs at least once.'],
  steps:['Count down from n to 1 with while.','Run a block once with do-while.'],
  example:'let n = 5;\nwhile (n > 0) { console.log(n); n--; } // 5 4 3 2 1\ndo { console.log("once"); } while (false);',
  quiz:[
    ['while (false) runs?','0 times',['1 time','infinite','error']],
    ['do-while runs at least?','1 time',['0 times','2 times','infinite']],
    ['What danger does while have?','Infinite loop if cond stays true',['Crash','Slow print','None']],
    ['let i = 0; while (i < 3) { i++; } — final i?','3',['0','2','infinite']],
    ['Which runs the body first, while or do-while?','do-while',['while','both same','neither']],
    ['How to stop an infinite loop in a browser?','Reload / close tab',['Turn off WiFi','Press Esc twice','Nothing']],
    ['while (true) is?','An infinite loop (unless break)',['Valid and safe','Error','Runs once']],
    ['Can while use any condition?','Yes, any truthy value',['Only numbers','Only strings','Only booleans']],
  ],
  gen: { kind:'loop', variant:'while' } },
{ id:'functions', n:11, level:'Beginner', title:'Functions',
  points:['function name(params) { ... return value; } declares a function.','Call it with name(args).','return exits the function and gives back a value.'],
  steps:['Write add(a, b) that returns a + b.','Write a function with no parameters.','Call your function and log the result.'],
  example:'function add(a, b) {\n  return a + b;\n}\nadd(2, 3); // 5\nfunction greet() { return "Hello!"; }',
  quiz:[
    ['What keyword declares a function?','function',['def','fun','func']],
    ['What does return do?','Exits the function with a value',['Prints','Loops','Declares a var']],
    ['add(2, 3) with function add(a,b){return a+b} is?','5',['23','error','undefined']],
    ['Can a function have zero parameters?','Yes',['No','Only one','Only two']],
    ['What happens without return?','undefined is returned',['null','0','error']],
    ['Can functions call other functions?','Yes',['No','Only once','Only in classes']],
    ['function f() {} — calling f() returns?','undefined',['null','void','error']],
    ['Parameters are also called?','Arguments (when passed)',['Elements','Properties','Keys']],
  ],
  gen: { kind:'fn', variant:'basic' } },
{ id:'scope', n:12, level:'Beginner', title:'Scope',
  points:['Variables declared inside a block { } are not visible outside it.','Inner scopes can read outer variables (closure preview).','let/const are block-scoped; var is function-scoped.'],
  steps:['Predict what x is after the block runs.','Try accessing a block variable outside — error.'],
  example:'let x = 1;\n{ let x = 2; console.log(x); } // 2\nconsole.log(x); // 1\nfunction f() { let y = 5; }\n// y is not defined here',
  quiz:[
    ['let inside a block is visible outside?','No (block scope)',['Yes','Only globally','Only with var']],
    ['var inside a function is visible outside?','No (function scope)',['Yes','Only in strict mode','Sometimes']],
    ['Inner function can read outer let?','Yes (lexical scope)',['No','Only var','Only const']],
    ['let x = 1; { let x = 2; } — outer x is?','1',['2','undefined','error']],
    ['Global variables are visible?','Everywhere',['Only in functions','Only in blocks','Only once']],
    ['Redeclaring let in the same scope?','SyntaxError',['Allowed','Updates','Becomes var']],
    ['What is the outermost scope called?','Global scope',['World scope','Main scope','Top scope']],
    ['Shadowing means?','Inner variable hides outer one',['Deleting a var','Looping','Error']],
  ],
  gen: { kind:'concept', variant:'scope' } },
{ id:'arrays', n:13, level:'Beginner', title:'Arrays',
  points:['An array is an ordered list: [1, 2, 3].','Indexing starts at 0: arr[0] is the first element.','arr.length is the number of elements.'],
  steps:['Create an array of 3 numbers.','Read arr[0] and arr.length.','push() adds to the end, pop() removes from the end.'],
  example:'let a = [10, 20, 30];\na[0];        // 10\na.length;    // 3\na.push(40);  // [10,20,30,40]\na.pop();     // removes 40',
  quiz:[
    ['[1,2,3][0] is?','1',['2','3','undefined']],
    ['[1,2,3].length is?','3',['2','4','0']],
    ['push adds where?','The end',['The start','Middle','Random']],
    ['pop removes from?','The end',['The start','Middle','All']],
    ['[5][1] is?','undefined',['5','error','0']],
    ['Can arrays mix types?','Yes',['No','Only numbers','Only strings']],
    ['shift() removes from?','The start',['The end','Middle','All']],
    ['unshift adds where?','The start',['The end','Middle','None']],
  ],
  gen: { kind:'arr' } },
{ id:'array-methods', n:14, level:'Beginner', title:'Array Methods (basics)',
  points:['indexOf(x) finds the index of x (-1 if missing).','includes(x) checks if x exists.','join("-") merges elements into a string.','slice(a, b) copies a part of the array.'],
  steps:['Use indexOf and includes on an array.','join an array with "-".','slice the middle two elements.'],
  example:'[10, 20, 30].indexOf(20);    // 1\n[10, 20].includes(30);       // false\n["a","b","c"].join("-");     // "a-b-c"\n[1,2,3,4].slice(1, 3);       // [2, 3]',
  quiz:[
    ['[1,2,3].indexOf(9) is?','-1',['0','3','undefined']],
    ['[1,2].includes(2) is?','true',['false','-1','error']],
    ['["a","b"].join("") is?','"ab"',['"a b"','["a","b"]','error']],
    ['[1,2,3,4].slice(0, 2) is?','[1, 2]',['[2,3]','[1,2,3]','error']],
    ['slice modifies the original?','No, it copies',['Yes, always','Sometimes','Only if const']],
    ['indexOf uses which equality?','Strict (===)',['Loose (==)','None','Random']],
    ['[1,2,3].includes("2") is?','false (type matters)',['true','error','-1']],
    ['join() with no argument uses?','Comma ,',['Space','Dash','Nothing']],
  ],
  gen: { kind:'arrMethod' } },
{ id:'objects', n:15, level:'Beginner', title:'Objects',
  points:['An object stores key: value pairs: { name: "Amara", age: 20 }.','Access with dot: user.name, or brackets: user["name"].','Add or change properties by assignment.'],
  steps:['Create an object with 3 properties.','Read a property with dot notation.','Change a property and add a new one.'],
  example:'let user = { name: "Amara", age: 20 };\nuser.name;      // "Amara"\nuser["age"];    // 20\nuser.city = "Monrovia"; // add',
  quiz:[
    ['{a: 1}.a is?','1',['undefined','"a"','error']],
    ['{a: 1}["a"] is?','1',['undefined','error','"1"']],
    ['How to add a property to obj?','obj.newKey = value',['obj + newKey','add(obj, key)','obj::key']],
    ['Can keys have spaces?','Yes, with quotes: {"my key": 1}',['No','Only numbers','Only in arrays']],
    ['Object keys are always?','Strings (or symbols)',['Numbers only','Booleans','Arrays']],
    ['user.age where user = {age: 20}?','20',['undefined','"age"','error']],
    ['Can objects hold arrays?','Yes',['No','Only numbers','Only in classes']],
    ['How many properties can an object have?','As many as you need',['Max 10','Max 100','1']],
  ],
  gen: { kind:'obj' } },
{ id:'template-strings', n:16, level:'Beginner', title:'Template Literals',
  points:['Backticks `...` create template literals.','${expression} is interpolated inside.','They can span multiple lines.'],
  steps:['Build "Hello, <name>!" with a template literal.','Interpolate an expression: `${a + b}`.'],
  example:'let name = "Amara";\n`Hello, ${name}!`;        // "Hello, Amara!"\nlet a = 2, b = 3;\n`${a} + ${b} = ${a + b}`; // "2 + 3 = 5"',
  quiz:[
    ['Which quotes make a template literal?','Backticks `',['Double "','Single \'','Slash /']],
    ['`1+1=${1+1}` is?','"1+1=2"',['"1+1=${1+1}"','error','"2"']],
    ['Can template literals span lines?','Yes',['No','Only in comments','Only with \\n']],
    ['${} contains?','A JavaScript expression',['Only text','Only CSS','Only HTML']],
    ['`hi ${"x"}` is?','"hi x"',['"hi ${x}"','error','"hix"']],
    ['Template literals were added in?','ES6 (2015)',['ES3','ES1','Last year']],
    ['`a${1}b` is?','"a1b"',['"a${1}b"','error','"ab"']],
    ['Can you nest backticks?','Only with escaping \\`',['Yes freely','No','Only in strings']],
  ],
  gen: { kind:'tmpl' } },
{ id:'type-coercion', n:17, level:'Beginner', title:'Type Coercion',
  points:['JS converts types automatically in many operations (+ with a string, comparisons).','Use Number(), String(), Boolean() for explicit conversion.','=== avoids surprises because it does not coerce.'],
  steps:['Predict "5" + 3 and 5 - "2".','Use Number("42") to convert text to a number.'],
  example:'"5" + 3;      // "53" (string concat)\n5 - "2";      // 3 (numeric)\n"5" * "2";    // 10\nNumber("42"); // 42\nBoolean(0);   // false',
  quiz:[
    ['"5" + 3 is?','"53"',['8','"5 3"','error']],
    ['"5" - 3 is?','2',['"53"','NaN','error']],
    ['Number("42") + 1 is?','43',['"421"','error','NaN']],
    ['Boolean("") is?','false',['true','null','error']],
    ['Boolean("hi") is?','true',['false','null','error']],
    ['String(42) is?','"42"',['42','undefined','error']],
    ['Which comparison avoids coercion?','===',['==','!=','>']],
    ['"" + 5 is?','"5"',['5','error','undefined']],
  ],
  gen: { kind:'coerce' } },
{ id:'console-debug', n:18, level:'Beginner', title:'console & Debugging',
  points:['console.log, .warn, .error print to the console.','The Playground below captures console output for you.','debugger; pauses execution when devtools are open.'],
  steps:['Log several values in one call: console.log(a, b).','Use console.warn for warnings.','Remove debug logs before shipping.'],
  example:'console.log("x is", 42);\nconsole.warn("careful!");\nconsole.error("something failed");\nconsole.table([{a:1},{a:2}]);',
  quiz:[
    ['console.warn shows?','A warning',['An error','Nothing','A table']],
    ['console.log(1, 2) prints?','1 2 (both)',['Just 1','Just 2','error']],
    ['debugger; does what?','Pauses when devtools open',['Prints','Deletes','Loops']],
    ['Where do console messages appear?','The browser console',['On paper','In the URL','In a file']],
    ['console.error is for?','Errors',['Tables','Warnings','Logs']],
    ['How to clear the console?','console.clear()',['console.delete()','console.remove()','reload']],
    ['Can you log objects?','Yes, they expand',['No','Only strings','Only numbers']],
    ['console.table shows?','Data as a table',['Errors','Warnings','Nothing']],
  ],
  gen: { kind:'log', variant:'multi' } },
// ---------------- INTERMEDIATE 19-35 ----------------
{ id:'arrow-functions', n:19, level:'Intermediate', title:'Arrow Functions',
  points:['const f = (a, b) => a + b; is a compact function.','One parameter can omit parentheses: x => x * 2.','Arrow functions do not have their own `this`.'],
  steps:['Rewrite function add(a,b){return a+b} as an arrow.','Use a single-parameter arrow.'],
  example:'const add = (a, b) => a + b;\nconst double = x => x * 2;\nadd(2, 3);   // 5\ndouble(4);   // 8',
  quiz:[
    ['const f = x => x * 2; f(3) is?','6',['3','"x*2"','error']],
    ['Arrow functions have their own this?','No (they inherit it)',['Yes','Sometimes','Only in classes']],
    ['(a, b) => a + b is the same as?','function (a, b) { return a + b; }',['return a + b;','a + b','error']],
    ['Can arrow functions omit parens for one param?','Yes',['No','Only for zero','Only in strict']],
    ['const f = () => 42; f() is?','42',['undefined','error','0']],
    ['Arrows were added in?','ES6 (2015)',['ES5','ES3','ES2020']],
    ['x => { return x; } can be written?','x => x',['No','Only with const','Never']],
    ['Do arrows need the function keyword?','No',['Yes','Sometimes','In classes']],
  ],
  gen: { kind:'fn', variant:'arrow' } },
{ id:'destructuring', n:20, level:'Intermediate', title:'Destructuring',
  points:['const {a, b} = obj pulls properties into variables.','const [x, y] = arr pulls array items.','Defaults: const {a = 1} = {}.'],
  steps:['Destructure {name, age} into two variables.','Destructure an array into first/second.','Use a default value.'],
  example:'const user = { name: "Amara", age: 20 };\nconst { name, age } = user;\nconst [first, second] = [10, 20];',
  quiz:[
    ['const {a} = {a: 1}; a is?','1',['undefined','{a:1}','error']],
    ['const [x] = [5, 6]; x is?','5',['6','[5,6]','undefined']],
    ['const {a = 9} = {}; a is?','9 (default)',['undefined','error','{}']],
    ['Destructuring objects uses which brackets?','{ }',['[ ]','( )','< >']],
    ['Destructuring arrays uses?','[ ]',['{ }','( )','` `']],
    ['const [a, , c] = [1, 2, 3]; c is?','3',['2','1','undefined']],
    ['Can you rename while destructuring?','Yes: {a: b}',['No','Only arrays','Only with var']],
    ['Destructuring came in?','ES6',['ES5','ES3','ES2022']],
  ],
  gen: { kind:'concept', variant:'destructure' } },
{ id:'spread-rest', n:21, level:'Intermediate', title:'Spread & Rest',
  points:['...spread copies arrays/objects: [...a, ...b].','...rest collects remaining args: function f(...args).'],
  steps:['Merge two arrays with spread.','Collect all function arguments with rest.'],
  example:'const a = [1, 2], b = [3, 4];\n[...a, ...b];            // [1,2,3,4]\nfunction sum(...nums) { return nums.reduce((s, n) => s + n, 0); }',
  quiz:[
    ['[...[1,2], ...[3]] is?','[1,2,3]',['[1,2,3] nested','error','[1,2][3]']],
    ['...args in a function collects?','All arguments into an array',['First arg','Last arg','Nothing']],
    ['Spread of an object copies?','Its own properties',['Its prototype','Nothing','Methods only']],
    ['const copy = [...arr] makes?','A shallow copy',['The same array','A string','A number']],
    ['... is called?','Spread (or rest, in params)',['Dot','Comma','Star']],
    ['[..."ab"] is?','["a","b"]',['"ab"','error','["ab"]']],
    ['Rest must be the last parameter?','Yes',['No','Anywhere','Only first']],
    ['Spread came in?','ES6',['ES5','ES3','ES2021']],
  ],
  gen: { kind:'concept', variant:'spread' } },
{ id:'map-filter', n:22, level:'Intermediate', title:'map & filter',
  points:['arr.map(fn) returns a NEW array with fn applied to each item.','arr.filter(fn) returns items where fn is truthy.','Neither modifies the original array.'],
  steps:['Double every number with map.','Keep only even numbers with filter.'],
  example:'[1,2,3].map(x => x * 2);      // [2,4,6]\n[1,2,3,4].filter(x => x % 2 === 0); // [2,4]',
  quiz:[
    ['[1,2,3].map(x => x * 2) is?','[2,4,6]',['[2,4]','[6]','error']],
    ['[1,2,3,4].filter(x => x > 2) is?','[3,4]',['[1,2]','[2,4]','error']],
    ['map returns?','A new array',['The same array','A number','An object']],
    ['filter keeps items where the fn returns?','Truthy values',['Only true','Only numbers','Strings']],
    ['Does map modify the original?','No',['Yes','Sometimes','Only if const']],
    ['[1,2,3].map(x => x + 1).length is?','3',['1','2','error']],
    ['filter with x => true returns?','A copy of the array',['[]','The same ref','error']],
    ['map/filter came in?','ES5',['ES6','ES3','ES2020']],
  ],
  gen: { kind:'fn', variant:'map' } },
{ id:'reduce', n:23, level:'Intermediate', title:'reduce',
  points:['arr.reduce((acc, x) => ..., initial) folds the array into one value.','acc is the accumulator; start with 0 for sums, [] for arrays.'],
  steps:['Sum an array with reduce.','Find the max with reduce.'],
  example:'[1,2,3,4].reduce((s, x) => s + x, 0);   // 10\n[3,1,4].reduce((m, x) => Math.max(m, x), 0); // 4',
  quiz:[
    ['[1,2,3].reduce((s,x) => s + x, 0) is?','6',['1','"123"','error']],
    ['reduce returns?','A single accumulated value',['An array','The original','undefined']],
    ['Initial value 0 is for?','Sums',['Strings','Objects','Nothing']],
    ['[1,2,3].reduce((s,x) => s * x, 1) is?','6',['1','0','9']],
    ['Can reduce build an array?','Yes, with [] initial',['No','Only objects','Only strings']],
    ['reduce without initial uses?','The first element as acc',['0','null','undefined']],
    ['reduce is on?','Arrays',['Objects only','Strings only','Numbers']],
    ['[5].reduce((s,x)=>s+x) is?','5',['error','0','[5]']],
  ],
  gen: { kind:'fn', variant:'reduce' } },
{ id:'find-some-every', n:24, level:'Intermediate', title:'find, some, every, includes',
  points:['find(fn) returns the first matching item (or undefined).','some(fn) — is at least one true? every(fn) — are all true?','includes(x) — does the array contain x?'],
  steps:['Find the first number > 10.','Check if any number is negative.','Check if all are positive.'],
  example:'[5, 12, 8].find(x => x > 10);        // 12\n[5, 12].some(x => x > 10);           // true\n[5, 12].every(x => x > 10);          // false\n[5, 12].includes(12);                // true',
  quiz:[
    ['[1,2,3].find(x => x > 1) is?','2',['1','3','undefined']],
    ['[1,2].some(x => x > 5) is?','false',['true','undefined','error']],
    ['[1,2].every(x => x > 0) is?','true',['false','undefined','error']],
    ['[1,2,3].find(x => x > 9) is?','undefined',['null','error','9']],
    ['includes uses which equality?','Strict ===',['Loose ==','None','Random']],
    ['some returns?','A boolean',['The item','An array','undefined']],
    ['every on empty array is?','true (vacuously)',['false','error','undefined']],
    ['find returns the first?','Matching item',['Last item','All matches','Count']],
  ],
  gen: { kind:'fn', variant:'find' } },
{ id:'sorting', n:25, level:'Intermediate', title:'Sorting Arrays',
  points:['arr.sort() sorts as STRINGS by default — [10, 9].sort() gives [10, 9]!','Always pass a comparator: (a, b) => a - b for numbers.','sort() modifies the array in place.'],
  steps:['Sort numbers ascending with a comparator.','Sort descending: (a, b) => b - a.','Sort objects by a property.'],
  example:'[10, 9, 2].sort((a, b) => a - b);  // [2, 9, 10]\n[10, 9].sort();                    // [10, 9] (string sort!)\n["b","a"].sort();                  // ["a", "b"]',
  quiz:[
    ['[10, 9].sort() gives?','[10, 9] (string sort!)',['[9,10]','error','[10,9] sorted']],
    ['[3,1,2].sort((a,b) => a - b) is?','[1,2,3]',['[3,1,2]','[2,1,3]','error']],
    ['Descending comparator?','(a, b) => b - a',['(a,b) => a + b','(a,b) => a','sort(-1)']],
    ['sort modifies the original?','Yes, in place',['No','Only copies','Sometimes']],
    ['["b","a"].sort() is?','["a","b"]',['["b","a"]','error','random']],
    ['To sort strings descending?','(a,b) => b.localeCompare(a)',['(a,b) => a - b','sort()','error']],
    ['Does sort return the array?','Yes, the same array',['A copy','undefined','A number']],
    ['Stable sort means?','Equal items keep order',['Random order','Reversed','Deleted']],
  ],
  gen: { kind:'fn', variant:'sort' } },
{ id:'string-methods', n:26, level:'Intermediate', title:'String Methods',
  points:['split(" ") turns a string into an array.','replace / replaceAll swap text.','startsWith / endsWith / includes check.','padStart / repeat are handy too.'],
  steps:['Split a sentence into words.','Replace all "cat" with "dog".','Check startsWith("Hello").'],
  example:'"a b c".split(" ");            // ["a","b","c"]\n"cat cat".replaceAll("cat", "dog"); // "dog dog"\n"Hello".startsWith("He");      // true\n"ab".repeat(3);                // "ababab"',
  quiz:[
    ['"a,b".split(",") is?','["a","b"]',['"a,b"','["a,b"]','error']],
    ['"aaa".replaceAll("a", "b") is?','"bbb"',['"baa"','"aaa"','error']],
    ['"hello".startsWith("he") is?','true',['false','error','undefined']],
    ['"ab".repeat(2) is?','"abab"',['"ab"','"aabb"','error']],
    ['"x".padStart(3, "0") is?','"00x"',['"x00"','"000"','error']],
    ['"Hi There".toLowerCase() is?','"hi there"',['"Hi There"','"HI THERE"','error']],
    ['split with no arg?','Splits into characters',['Splits on spaces','Returns string','error']],
    ['replaceAll came in?','ES2021',['ES5','ES6','ES3']],
  ],
  gen: { kind:'str', variant:'methods' } },
{ id:'json', n:27, level:'Intermediate', title:'JSON',
  points:['JSON.stringify(obj) — object to string.','JSON.parse(str) — string back to object.','Keys must be double-quoted in JSON.'],
  steps:['Stringify an object and inspect the text.','Parse it back and read a property.'],
  example:'JSON.stringify({a: 1});        // \'{"a":1}\'\nJSON.parse(\'{"a":1}\').a;     // 1',
  quiz:[
    ['JSON.stringify({a:1}) is?','\'{"a":1}\'',['"{a:1}"','error','1']],
    ['JSON.parse(\'{"a":1}\').a is?','1',['undefined','"1"','error']],
    ['JSON keys must be?','Double-quoted',['Single-quoted','Unquoted ok','Backticked']],
    ['Can JSON hold functions?','No',['Yes','Sometimes','Only arrow']],
    ['JSON stands for?','JavaScript Object Notation',['Java Serial Output','JavaScript Open Network','Json Object Name']],
    ['JSON.parse of invalid text?','Throws an error',['Returns null','Returns {}','undefined']],
    ['JSON.stringify(undefined) is?','undefined (not a string)',['"undefined"','null','error']],
    ['Round-trip: parse(stringify(x)) equals?','x (for JSON-safe data)',['Always','Never','Only arrays']],
  ],
  gen: { kind:'json' } },
{ id:'dates', n:28, level:'Intermediate', title:'Dates',
  points:['new Date(y, month, day) — month is 0-based (0 = January).','getFullYear(), getMonth(), getDate(), getDay() read parts.','Date.now() gives milliseconds since 1970.'],
  steps:['Create a date and read its year.','Read the month number (remember 0-based!).'],
  example:'new Date(2026, 0, 15);        // Jan 15, 2026\nnew Date(2026, 0, 15).getMonth();  // 0 (January!)\nnew Date(2026, 11, 31).getFullYear(); // 2026',
  quiz:[
    ['new Date(2026, 0, 1).getMonth() is?','0 (January)',['1','12','error']],
    ['new Date(2026, 11, 31).getMonth() is?','11 (December)',['12','0','error']],
    ['Date.now() returns?','Milliseconds since 1970',['Seconds','Years','A Date object']],
    ['getFullYear() of new Date(2026, 5, 1)?','2026',['2025','error','26']],
    ['new Date(2026, 5, 10).getDate() is?','10',['9','11','5']],
    ['Month 0 is?','January',['December','Error','June']],
    ['getDay() returns?','Day of week (0 = Sunday)',['Day of month','Month','Year']],
    ['How to get current year?','new Date().getFullYear()',['Date.year()','Date.now().year','year()']],
  ],
  gen: { kind:'date' } },
{ id:'try-catch', n:29, level:'Intermediate', title:'Error Handling',
  points:['try { ... } catch (e) { ... } handles errors.','finally { ... } always runs.','throw new Error("msg") raises an error.'],
  steps:['Parse invalid JSON inside try/catch.','Throw your own error.'],
  example:'try {\n  JSON.parse("not json");\n} catch (e) {\n  console.log("Caught:", e.message);\n} finally {\n  console.log("done");\n}',
  quiz:[
    ['try without catch?','SyntaxError (need catch or finally)',['Valid','Runs fine','Only warn']],
    ['catch receives?','The error object',['A string','Nothing','The code']],
    ['finally runs?','Always',['Only on error','Only on success','Never']],
    ['throw new Error("x") does?','Raises an error',['Prints x','Returns x','Nothing']],
    ['JSON.parse("bad") throws?','SyntaxError',['TypeError','null','undefined']],
    ['Can you catch your own throw?','Yes, in the surrounding try',['No','Only global','Only async']],
    ['e.message is?','The error message string',['The code','The stack','A number']],
    ['Multiple catch blocks?','No (one catch, check e)',['Yes, unlimited','Only 2','Only for SyntaxError']],
  ],
  gen: { kind:'fn', variant:'try' } },
{ id:'callbacks', n:30, level:'Intermediate', title:'Callbacks',
  points:['A callback is a function passed into another function.','setTimeout(fn, ms) calls fn later — classic callback.','Callbacks can nest (beware "callback hell" — promises fix it).'],
  steps:['Pass a function to setTimeout.','Write your own function that takes a callback.'],
  example:'function greet(name, cb) { cb("Hello, " + name); }\ngreet("Amara", msg => console.log(msg));\nsetTimeout(() => console.log("later!"), 1000);',
  quiz:[
    ['A callback is?','A function passed as an argument',['A variable','An event','A loop']],
    ['setTimeout(() => {}, 1000) runs after?','1000 ms (1 s)',['1 ms','100 ms','never']],
    ['How many args does setTimeout take at least?','2 (fn, ms)',['1','3','0']],
    ['Nested callbacks are called?','Callback hell',['Clean code','Fast','Typed']],
    ['Can callbacks be anonymous?','Yes',['No','Only named','Only arrow']],
    ['clearTimeout(id) does?','Cancels the timeout',['Runs it now','Deletes fn','Error']],
    ['setTimeout returns?','A timer id',['The fn result','undefined','A promise']],
    ['Callbacks run synchronously?','No, later (async)',['Yes always','Only in loops','Only with await']],
  ],
  gen: { kind:'concept', variant:'callback' } },
{ id:'promises', n:31, level:'Intermediate', title:'Promises',
  points:['A Promise is a future value: pending, fulfilled, or rejected.','Promise.resolve(v) — fulfilled with v. Promise.reject(e) — rejected.','.then(onOk) / .catch(onErr) / .finally().'],
  steps:['Create a resolved promise and read it with .then.','Chain two .then calls.','Catch a rejection.'],
  example:'Promise.resolve(42).then(v => console.log(v)); // 42\nPromise.reject("boom").catch(e => console.log(e)); // "boom"',
  quiz:[
    ['Promise.resolve(5) state?','Fulfilled with 5',['Pending','Rejected','None']],
    ['.then runs when?','When fulfilled',['When rejected','Immediately sync','Never']],
    ['.catch runs when?','When rejected',['When fulfilled','Always','Never']],
    ['Promise states are?','pending / fulfilled / rejected',['open / closed','sync / async','ok / bad']],
    ['new Promise((resolve) => resolve(1)) value?','1',['undefined','pending','error']],
    ['Can you chain .then?','Yes',['No','Only twice','Only with var']],
    ['A promise settles?','Once (then it is settled)',['Many times','Never','Randomly']],
    ['Promises solve?','Callback hell',['Loops','Arrays','Types']],
  ],
  gen: { kind:'promise' } },
{ id:'async-await', n:32, level:'Intermediate', title:'async / await',
  points:['async function f() { ... } returns a Promise.','await p pauses until the promise settles — inside async only.','await makes async code read like sync code.'],
  steps:['Write an async function that awaits Promise.resolve.','Use try/catch around await for errors.'],
  example:'async function getValue() {\n  const v = await Promise.resolve(42);\n  return v * 2;\n}\ngetValue().then(console.log); // 84',
  quiz:[
    ['async function returns?','A Promise',['A value','undefined','An array']],
    ['await can be used?','Only inside async functions',['Anywhere','Only in loops','Only in classes']],
    ['await Promise.resolve(3) gives?','3',['a promise','undefined','error']],
    ['async () => 5 returns?','Promise resolving to 5',['5','undefined','error']],
    ['await on a non-promise?','Wraps it in a promise',['Error','Returns undefined','Infinite loop']],
    ['try/catch around await catches?','Rejections',['Syntax errors only','Nothing','Only sync errors in the try']],
    ['await pauses?','The async function until settled',['The whole program','Nothing','The browser']],
    ['async/await came in?','ES2017 (ES8)',['ES5','ES6','ES2020']],
  ],
  gen: { kind:'promise', variant:'async' } },
{ id:'timers', n:33, level:'Intermediate', title:'Timers',
  points:['setTimeout(fn, ms) runs once after ms.','setInterval(fn, ms) repeats every ms.','clearTimeout / clearInterval stop them using the returned id.'],
  steps:['Run code once after 500 ms.','Repeat every second, then stop after 3 times.'],
  example:'const id = setInterval(() => console.log("tick"), 1000);\nclearInterval(id); // stops',
  quiz:[
    ['setTimeout(fn, 2000) runs after?','2 seconds',['2 ms','20 s','never']],
    ['setInterval repeats?','Every interval',['Once','Twice','Never']],
    ['clearTimeout takes?','The timer id',['The fn','The ms','Nothing']],
    ['setTimeout returns?','A timer id (number in browsers)',['undefined','The result','A promise']],
    ['1000 ms equals?','1 second',['0.1 s','10 s','100 s']],
    ['Does clearInterval work on setTimeout ids?','No (use clearTimeout)',['Yes','Sometimes','Always']],
    ['Timers are?','Asynchronous (macrotasks)',['Synchronous','Blocking','Sync only']],
    ['Minimum delay is clamped to about?','~4 ms after nesting (1 ms first)',['0 ms exactly','1 hour','No limit']],
  ],
  gen: { kind:'concept', variant:'timers' } },
{ id:'dom', n:34, level:'Intermediate', title:'DOM Basics',
  points:['document.getElementById("id") finds an element.','el.textContent / el.innerHTML change content.','el.style.color changes style; addEventListener binds events.'],
  steps:['In the practice sandbox there is a div#out — set its text.','Change its color with style.','Add a click listener.'],
  example:'const el = document.getElementById("out");\nel.textContent = "Hello";\nel.style.color = "green";\nel.addEventListener("click", () => console.log("clicked"));',
  quiz:[
    ['document.getElementById("out") finds?','The element with id "out"',['A class','A tag','Nothing']],
    ['el.textContent = "hi" sets?','Plain text',['HTML','Style','Events']],
    ['el.innerHTML = "<b>x</b>" sets?','HTML markup',['Plain text','CSS','JS']],
    ['addEventListener binds?','An event handler',['A style','A variable','A loop']],
    ['el.style.color = "red" changes?','Text color',['Background of page','Font size','Nothing']],
    ['querySelector(".cls") finds?','First element with class cls',['All ids','All tags','Nothing']],
    ['remove() does?','Removes the element',['Hides it','Clears text','Changes color']],
    ['DOM stands for?','Document Object Model',['Data Object Model','Document Open Mode','Dynamic Object Maker']],
  ],
  gen: { kind:'dom' } },
{ id:'regex', n:35, level:'Intermediate', title:'Regular Expressions',
  points:['/pattern/ is a regex literal; new RegExp("pattern") also works.','.test(str) returns true/false.','^ start, $ end, \\d digit, \\w word char, + one or more, * zero or more.'],
  steps:['Test if a string is all digits: /^\\d+$/.','Match an email-like pattern.'],
  example:'/^\\d+$/.test("123");     // true\n/^\\d+$/.test("12a");     // false\n"a1b2".replace(/\\d/g, "*"); // "a*b*"',
  quiz:[
    ['/^\\d+$/.test("42") is?','true',['false','error','undefined']],
    ['/^\\d+$/.test("4a") is?','false',['true','error','null']],
    ['\\d matches?','A digit',['A letter','A space','Anything']],
    ['+ means?','One or more',['Zero or one','Exactly one','Any']],
    ['* means?','Zero or more',['One or more','Exactly two','None']],
    ['.test returns?','A boolean',['The match','A string','An array']],
    ['^ anchors to?','Start of string',['End','Middle','Anywhere']],
    ['Regex literal looks like?','/abc/',['"abc"','(abc)','<abc>']],
  ],
  gen: { kind:'regex' } },
// ---------------- ADVANCED 36-50 ----------------
{ id:'closures', n:36, level:'Advanced', title:'Closures',
  points:['A closure is a function that remembers its outer variables.','Each call to the outer function creates a NEW closure.','Used for counters, private data, factories.'],
  steps:['Build a counter factory.','See that two counters are independent.'],
  example:'function makeCounter() {\n  let n = 0;\n  return () => ++n;\n}\nconst c = makeCounter();\nc(); c(); // 2',
  quiz:[
    ['A closure remembers?','Outer scope variables',['Global only','Nothing','The DOM']],
    ['Two counters from one factory are?','Independent',['Shared','Equal','Linked']],
    ['let in outer function + inner function = ?','A closure',['A global','An error','A class']],
    ['Closures are used for?','Private state / factories',['Loops only','Arrays','Styles']],
    ['function outer(){ let x = 1; return () => x; } — inner sees x?','Yes (1)',['No','undefined','error']],
    ['Memory note: closures keep outer vars?','Alive while referenced',['Deleted immediately','Never','Randomly']],
    ['Classic example?','Counter / memoization',['Sorting','Printing','Parsing']],
    ['Closure created when?','When the inner function is created',['At compile','Never','At import']],
  ],
  gen: { kind:'fn', variant:'closure' } },
{ id:'this-keyword', n:37, level:'Advanced', title:'The this Keyword',
  points:['In a method, this is the object the method was called on.','In a plain function, this is undefined (strict) or global.','Arrow functions inherit this from outside.'],
  steps:['Call an object method and use this.','Compare arrow vs normal function this.'],
  example:'const obj = { name: "A", hi() { return "hi " + this.name; } };\nobj.hi(); // "hi A"',
  quiz:[
    ['In obj.m(), this is?','obj',['undefined','global','window always']],
    ['Arrow functions have own this?','No (inherit outer)',['Yes','Sometimes','In classes only']],
    ['function f() { return this; } in strict mode?','undefined',['window','global','error']],
    ['call/apply can set?','this explicitly',['No','Only bind','Only new']],
    ['this in a method of {x: 1} is?','The object',['1','undefined','null']],
    ['bind creates?','A function with fixed this',['A loop','An array','A class']],
    ['Lost this is a common?','Bug (use arrow or bind)',['Feature','Style','Type']],
    ['this in event handler (normal fn) is?','The element',['document','window','undefined']],
  ],
  gen: { kind:'concept', variant:'this' } },
{ id:'prototypes', n:38, level:'Advanced', title:'Prototypes',
  points:['Every object has a prototype it inherits from.','Methods on the prototype are shared by all instances.','obj.__proto__ (or Object.getPrototypeOf) links to it.'],
  steps:['Add a method to a constructor\'s prototype.','See all instances share it.'],
  example:'function Dog(name) { this.name = name; }\nDog.prototype.bark = function () { return this.name + " says woof"; };\nnew Dog("Rex").bark();',
  quiz:[
    ['Adding to Foo.prototype affects?','All instances of Foo',['Only new ones','Nothing','Globals']],
    ['Object.getPrototypeOf(obj) returns?','obj\'s prototype',['Its constructor','Its keys','Nothing']],
    ['Every function has a prototype?','Yes',['No','Only classes','Only arrows']],
    ['Instance inherits methods via?','The prototype chain',['Copy-paste','Globals','Imports']],
    ['proto chain ends at?','null',['undefined','window','Object']],
    ['Changing prototype affects existing instances?','Yes',['No','Only new','Sometimes']],
    ['__proto__ is?','Legacy accessor for the prototype',['A keyword','A method','A loop']],
    ['Prototype of an array is?','Array.prototype',['Object','null','Array']],
  ],
  gen: { kind:'fn', variant:'proto' } },
{ id:'classes', n:39, level:'Advanced', title:'Classes',
  points:['class Animal { constructor(name) { this.name = name; } speak() {...} }','class Dog extends Animal — inheritance.','new creates an instance.'],
  steps:['Write a class with a constructor and a method.','Create two instances.'],
  example:'class Animal {\n  constructor(name) { this.name = name; }\n  speak() { return this.name + " makes a sound"; }\n}\nnew Animal("Cat").speak();',
  quiz:[
    ['class X { constructor() {} } — new X() is?','An instance of X',['A function','undefined','An error']],
    ['constructor runs when?','On new',['On declaration','On method call','Never']],
    ['class keyword came in?','ES6',['ES5','ES3','ES2022']],
    ['Methods in a class are on?','The prototype (shared)',['Each instance','Global','Stack']],
    ['Can classes have static methods?','Yes: static m() {}',['No','Only with var','Only arrows']],
    ['class fields like x = 1 came in?','ES2022',['ES6','ES3','ES5']],
    ['this in constructor refers to?','The new instance',['The class','Window','undefined']],
    ['A class is sugar over?','Prototypes',['Globals','Loops','Strings']],
  ],
  gen: { kind:'fn', variant:'class' } },
{ id:'inheritance', n:40, level:'Advanced', title:'Inheritance (extends)',
  points:['class Dog extends Animal { ... } inherits Animal.','super(...) calls the parent constructor.','Override methods by redefining them.'],
  steps:['Extend a base class.','Call super() in the child constructor.','Override a method.'],
  example:'class Animal { constructor(n) { this.name = n; } }\nclass Dog extends Animal {\n  constructor(n) { super(n); }\n  speak() { return this.name + " barks"; }\n}',
  quiz:[
    ['extends means?','Inherit from a parent class',['Copy code','Import','Loop']],
    ['super() in a child constructor calls?','The parent constructor',['The child','Nothing','Error']],
    ['Can a child override a parent method?','Yes',['No','Only static','Only with var']],
    ['super.method() calls?','The parent\'s method',['Own method','Global fn','Error']],
    ['A class can extend?','One class (single inheritance)',['Many classes','None','Arrays']],
    ['instanceof checks?','If obj is an instance of a class',['Types','Sizes','Names']],
    ['Without super() in child constructor?','ReferenceError when using this',['Works fine','Warning','Becomes null']],
    ['extends came with?','class (ES6)',['ES5','ES3','var']],
  ],
  gen: { kind:'fn', variant:'extends' } },
{ id:'recursion', n:41, level:'Advanced', title:'Recursion',
  points:['A function that calls itself is recursive.','Every recursion needs a base case to stop.','factorial, fibonacci, tree walks are classic examples.'],
  steps:['Write recursive factorial.','Write recursive fibonacci.','Add a base case!'],
  example:'function fact(n) {\n  if (n <= 1) return 1;   // base case\n  return n * fact(n - 1);\n}\nfact(5); // 120',
  quiz:[
    ['Recursion means?','A function calling itself',['A loop','A class','An import']],
    ['Every recursion needs?','A base case',['A global var','A class','A try/catch']],
    ['fact(4) with fact(n)=n<=1?1:n*fact(n-1) is?','24',['4','6','120']],
    ['Missing base case causes?','Stack overflow',['Slow code','Warning','Nothing']],
    ['fib(5) is?','5',['8','3','error']],
    ['Recursion can replace?','Many loops',['All code','Nothing','Only classes']],
    ['Tail recursion is?','A call in tail position (optimizable)',['A loop','An error','A class']],
    ['fib(0) base case is?','0',['1','error','undefined']],
  ],
  gen: { kind:'fn', variant:'recur' } },
{ id:'hof', n:42, level:'Advanced', title:'Higher-Order Functions',
  points:['A function that takes or returns a function is higher-order.','map/filter/reduce are built-in higher-order functions.','Write your own: function repeat(n, fn).'],
  steps:['Write repeat(3, fn) that calls fn 3 times.','Compose functions.'],
  example:'function repeat(n, fn) { for (let i = 0; i < n; i++) fn(i); }\nrepeat(3, i => console.log(i)); // 0 1 2',
  quiz:[
    ['Higher-order function?','Takes/returns a function',['Only returns','Only takes','Neither']],
    ['map is a?','Higher-order function',['A loop','A class','A type']],
    ['function f(g) { return g(2); } f(x => x * 10) is?','20',['2','error','undefined']],
    ['Compose means?','Chain functions together',['Split them','Delete them','Loop them']],
    ['Currying is?','Returning functions step by step',['A loop','An array','A string']],
    ['HOFs enable?','Reusable abstractions',['Globals','Only loops','Nothing']],
    ['filter is?','HOF',['A type','A keyword','A loop only']],
    ['const add = a => b => a + b; add(2)(3) is?','5',['2','error','23']],
  ],
  gen: { kind:'fn', variant:'hof' } },
{ id:'generators', n:43, level:'Advanced', title:'Generators',
  points:['function* gen() { yield 1; yield 2; } is a generator.','Each .next() runs until the next yield and returns {value, done}.','Generators are lazy — great for big/infinite sequences.'],
  steps:['Write a generator yielding 1, 2, 3.','Iterate it with a for...of loop.'],
  example:'function* nums() { yield 1; yield 2; yield 3; }\nfor (const n of nums()) console.log(n); // 1 2 3',
  quiz:[
    ['function* is?','A generator function',['A normal function','An arrow','A class']],
    ['yield does?','Pauses and returns a value',['Stops forever','Deletes','Loops']],
    ['gen.next() returns?','{value, done}',['The value only','A promise','An array']],
    ['done is true when?','Generator is finished',['First call','Every call','Never']],
    ['for...of works on generators?','Yes',['No','Only with await','Only manually']],
    ['Generators are?','Lazy (pause/resume)',['Eager','Sync only','Blocking']],
    ['yield can send values in?','Via next(arg)',['Only out','Never','Only errors']],
    ['Generators came in?','ES6',['ES5','ES3','ES2022']],
  ],
  gen: { kind:'fn', variant:'gen' } },
{ id:'iterators', n:44, level:'Advanced', title:'Iterators & Iterables',
  points:['An iterable has [Symbol.iterator]() returning an iterator.','Arrays, strings, Maps are iterable by default.','You can make your own iterable objects.'],
  steps:['Make a custom iterable (countdown).','Use it with for...of or spread.'],
  example:'const countdown = {\n  [Symbol.iterator]() { let n = 3; return { next: () => n > 0 ? { value: n--, done: false } : { value: undefined, done: true } }; }\n};\n[...countdown]; // [3, 2, 1]',
  quiz:[
    ['Symbol.iterator makes an object?','Iterable',['A promise','A class','A regex']],
    ['for...of requires?','An iterable',['A promise','An object','A number']],
    ['next() must return?','{value, done}',['A value','A promise','An array']],
    ['Strings are iterable?','Yes (characters)',['No','Only with split','Only numbers']],
    ['Spread works on?','Iterables',['Promises only','Objects only','Numbers']],
    ['Symbol.iterator is a?','Well-known symbol',['A string','A number','A method']],
    ['Map and Set are?','Iterable',['Not iterable','Only Map','Only Set']],
    ['Iterator protocol needs?','A next() method',['A then()','A catch()','A yield']],
  ],
  gen: { kind:'concept', variant:'iterator' } },
{ id:'proxy', n:45, level:'Advanced', title:'Proxy & Reflect',
  points:['new Proxy(target, handler) wraps an object with traps.','Common traps: get, set, has, deleteProperty.','Reflect mirrors the default behavior inside traps.'],
  steps:['Make a proxy that logs every get.','Validate set values.'],
  example:'const p = new Proxy({}, {\n  get(t, k) { console.log("get", k); return t[k]; },\n  set(t, k, v) { t[k] = v; return true; }\n});\np.x = 1; p.x;',
  quiz:[
    ['new Proxy needs?','A target and a handler',['Two targets','Nothing','A class']],
    ['get trap intercepts?','Property reads',['Writes','Deletes','Calls only']],
    ['set trap must return?','true on success',['The value','false always','An object']],
    ['Reflect.get is?','The default get behavior',['A loop','An error','A promise']],
    ['Proxy can?','Validate, log, virtualize objects',['Delete files','Hack servers','Only style']],
    ['has trap intercepts?','The `in` operator',['get','set','delete']],
    ['Proxies came in?','ES6',['ES5','ES3','ES2023']],
    ['Can you proxy functions?','Yes (apply trap)',['No','Only classes','Only arrows']],
  ],
  gen: { kind:'concept', variant:'proxy' } },
{ id:'event-loop', n:46, level:'Advanced', title:'Event Loop & Microtasks',
  points:['JS is single-threaded: one call stack.','Promise callbacks (.then) are MICROtasks — they run before the next macrotask.','setTimeout callbacks are MACROtasks.'],
  steps:['Predict the order: console.log(1); Promise.resolve().then(() => console.log(2)); setTimeout(() => console.log(3)); console.log(4);'],
  example:'console.log(1);\nPromise.resolve().then(() => console.log(2));\nsetTimeout(() => console.log(3), 0);\nconsole.log(4);\n// prints: 1 4 2 3',
  quiz:[
    ['Order: log(1); Promise.then(log 2); setTimeout(log 3, 0); log(4)?','1 4 2 3',['1 2 3 4','1 2 4 3','4 3 2 1']],
    ['Promise .then callbacks are?','Microtasks',['Macrotasks','Sync','Blocking']],
    ['setTimeout callbacks are?','Macrotasks',['Microtasks','Sync','Promises']],
    ['Microtasks run before?','The next macrotask',['All code','Nothing','Only timers']],
    ['How many threads does JS have?','One (call stack)',['Two','Many','None']],
    ['await schedules?','A microtask',['A macrotask','Nothing','A sync call']],
    ['queueMicrotask(fn) queues?','A microtask',['A timer','A promise reject','Nothing']],
    ['The event loop picks?','Tasks from queues when stack is empty',['Randomly','Only timers','Only promises']],
  ],
  gen: { kind:'concept', variant:'eventloop' } },
{ id:'modules', n:47, level:'Advanced', title:'Modules (import / export)',
  points:['export declares something public; import brings it in.','One module per file keeps code organized.','In this app, modules are conceptual — practice the syntax in your head/notes.'],
  steps:['Write export const x = 1; and import { x } from "./m.js".','Think in small, single-purpose files.'],
  example:'// math.js\nexport const add = (a, b) => a + b;\n// main.js\nimport { add } from "./math.js";\nadd(2, 3);',
  quiz:[
    ['export makes a binding?','Public to other modules',['Private','Global always','Deleted']],
    ['import syntax?','import { x } from "./m.js"',['require("./m.js")','include','using']],
    ['default export is?','One per module',['Many','None','Only functions']],
    ['Modules are loaded?','Asynchronously (deferred)',['Synchronously blocking','Never','Randomly']],
    ['Circular imports?','Allowed but tricky',['Errors always','Fine always','Only in Node']],
    ['import came in?','ES6 modules (ES2015)',['ES5','ES3','CommonJS only']],
    ['export default is used for?','The main export of a module',['All exports','Nothing','Only vars']],
    ['Module scope is?','File-local (not global)',['Global','Window','Shared']],
  ],
  gen: { kind:'concept', variant:'modules' } },
{ id:'memory', n:48, level:'Advanced', title:'Memory & Performance',
  points:['Unused objects are freed by the garbage collector — but only when unreachable.','Closures and event listeners can cause leaks if not removed.','Avoid work in loops: cache lengths, reuse objects.'],
  steps:['Think: what holds a reference to this object?','Remove listeners when done.'],
  example:'// leak: adding listeners in a loop without removing them\n// fix: keep the handler and call removeEventListener later',
  quiz:[
    ['Garbage collection frees?','Unreachable objects',['All objects','Reachable ones','Only arrays']],
    ['Common leak source?','Forgotten listeners/closures',['Loops','Strings','Numbers']],
    ['removeEventListener needs?','The same function reference',['Any function','A string','Nothing']],
    ['Big-O describes?','How runtime grows with input size',['Memory exactly','Colors','Names']],
    ['O(n) means?','Time grows linearly with n',['Constant','Quadratic','Logarithmic']],
    ['O(1) is?','Constant time (best)',['Linear','Slow','Infinite']],
    ['Premature optimization is?','Often wasted effort',['Always needed','A rule','A type']],
    ['Measure before?','Optimizing',['Deleting','Compiling','Typing']],
  ],
  gen: { kind:'concept', variant:'memory' } },
{ id:'testing', n:49, level:'Advanced', title:'Testing Your Code',
  points:['An assertion checks that actual === expected.','Write a tiny assert(cond, msg) helper.','Tests catch regressions when you change code.'],
  steps:['Write assert(x === 5, "x should be 5").','Test a function with several inputs.'],
  example:'function assert(cond, msg) {\n  if (!cond) throw new Error("FAIL: " + msg);\n  console.log("PASS:", msg);\n}\nassert(2 + 2 === 4, "math works");',
  quiz:[
    ['An assertion checks?','actual equals expected',['Types only','Speed','Style']],
    ['assert(false, "x") does?','Throws',['Passes','Warns','Returns null']],
    ['Tests are for?','Catching regressions',['Shipping faster only','Deleting code','Pretty output']],
    ['Unit tests test?','One small piece in isolation',['The whole app','The UI only','Nothing']],
    ['TDD means?','Test-driven development (tests first)',['Test after deploy','No tests','Type-driven']],
    ['A failing test means?','Code (or test) is wrong',['Always fine','Ignore it','Feature']],
    ['console.assert(cond, msg) logs?','An error if cond is false',['Always pass','Nothing','A table']],
    ['Good tests are?','Fast, independent, repeatable',['Slow','Random','Manual']],
  ],
  gen: { kind:'fn', variant:'test' } },
{ id:'final-project', n:50, level:'Advanced', title:'Final Project: Mini To-Do App',
  points:['Combine everything: arrays, objects, functions, loops.','Build addTask/removeTask/toggleDone/listTasks.','Then take the final exam and print your certificate!'],
  steps:['Implement the to-do functions in the practices.','Finish all 50 topics.','Pass the final exam (70%+) to unlock the certificate.'],
  example:'let tasks = [];\nfunction addTask(title) { tasks.push({ title, done: false }); }\nfunction listTasks() { return tasks.map(t => (t.done ? "[x] " : "[ ] ") + t.title).join("\\n"); }',
  quiz:[
    ['A to-do item is best stored as?','An object {title, done}',['A string only','A number','A boolean']],
    ['addTask should?','Push a new task',['Delete all','Sort','Print']],
    ['toggleDone flips?','The done flag',['The title','The array','Nothing']],
    ['listTasks returns?','A readable string',['An object','A number','undefined']],
    ['map + join can render?','A list as text',['Images','Sounds','Videos']],
    ['filter can show?','Only unfinished tasks',['All tasks','Deleted','Random']],
    ['The final exam needs?','70% to pass',['10%','100%','0%']],
    ['After the exam you get?','A printable certificate',['Nothing','A new phone','A virus']],
  ],
  gen: { kind:'fn', variant:'todo' } },
];

// ------------------------------------------------------------ gen dispatch
const rng = RNG(20261104);
const WORDS = ['apple', 'river', 'sun', 'book', 'star', 'rain', 'code', 'fish', 'tree', 'moon'];
const NAMES = ['Amara', 'John', 'Mary', 'Joseph', 'Grace', 'Peter', 'Fatmata', 'David'];
const CITIES = ['Monrovia', 'Gbarnga', 'Buchanan', 'Kakata', 'Ganta', 'Zwedru'];

function genFor(t, i) {
  const g = t.gen, r = rng;
  const n = 3 + (i % 18);
  const a = r.int(1, 50), b = r.int(1, 50);
  const w = WORDS[i % WORDS.length];
  const name = NAMES[i % NAMES.length], city = CITIES[i % CITIES.length];
  switch (g.kind) {
    case 'log': {
      if (g.variant === 'multi') {
        return mk(`Log exactly two values in ONE console.log call: ${JSON.stringify(w)} and the number ${i + 1}.`, '',
          `console.log(${JSON.stringify(w)}, ${i + 1});`,
          `__logs.length === 1 && __logs[0] === ${JSON.stringify(w + ' ' + (i + 1))}`);
      }
      return logPractice(`${w}-${i + 1}`);
    }
    case 'assign': {
      const vals = [i + 1, `"${w}"`, i % 2 === 0, null, undefined, i * 2 + 1, `"${city}"`, i % 3 === 0];
      return assignPractice('x', vals[i % vals.length]);
    }
    case 'typeof': {
      const vals = [i + 1, `"${w}"`, i % 2 === 0, null, undefined, 10n * BigInt(i + 1)];
      return typeofPractice(vals[i % vals.length]);
    }
    case 'math':
      return mathPractice(a, ['+', '-', '*', '%', '**'][i % 5], b);
    case 'boolmath':
      return i % 2 === 0 ? boolPractice(a, ['>', '<', '>=', '<='][i % 4], b) : mathPractice(a, '+', b);
    case 'bool':
      return boolPractice(a, ['>', '===', '!==', '&&', '||'][i % 5], i % 2 ? b : w);
    case 'str': {
      const kinds = g.variant === 'methods' ? ['length', 'upper', 'concat', 'slice', 'trim'] : ['length', 'upper', 'concat', 'slice', 'indexOf'];
      return strPractice(kinds[i % kinds.length], `${w}${i}`);
    }
    case 'ifFn': {
      const v = i + 1;
      const exp = v % 2 === 0 ? 'even' : 'odd';
      return mk(`Write a function \`parity(n)\` that returns "even" if n is even, otherwise "odd".`,
        '', `function parity(n) { return n % 2 === 0 ? "even" : "odd"; }`, `parity(${v}) === ${JSON.stringify(exp)}`);
    }
    case 'loop': {
      const kinds = g.variant === 'while' ? ['sum', 'stars'] : ['sum', 'fact', 'stars'];
      return loopPractice(kinds[i % kinds.length], Math.min(n + 2, 10));
    }
    case 'fn': {
      const v = g.variant || 'basic';
      if (v === 'arrow') {
        return mk(`Write an ARROW function \`triple\` that returns x * 3.`, '',
          `const triple = x => x * 3;`, `triple(${a}) === ${a * 3}`);
      }
      if (v === 'map') {
        const arr = [1, 2, 3, 4, 5].map(k => k + i % 3);
        const doubled = arr.map(x => x * 2);
        return mk(`Given \`arr = [${arr.join(', ')}]\`, store \`arr.map(x => x * 2)\` in \`doubled\`.`,
          `let arr = [${arr.join(', ')}];`, `let doubled = arr.map(x => x * 2);`,
          `JSON.stringify(doubled) === ${JSON.stringify(JSON.stringify(doubled))}`);
      }
      if (v === 'reduce') {
        const arr = [a, b, a + b];
        return mk(`Given \`arr = [${arr.join(', ')}]\`, store \`arr.reduce((s, x) => s + x, 0)\` in \`total\`.`,
          `let arr = [${arr.join(', ')}];`, `let total = arr.reduce((s, x) => s + x, 0);`, `total === ${a + b + (a + b)}`);
      }
      if (v === 'find') {
        const arr = [a, b, a + b + 5];
        return mk(`Given \`arr = [${arr.join(', ')}]\`, store \`arr.find(x => x > ${a + b})\` in \`found\`.`,
          `let arr = [${arr.join(', ')}];`, `let found = arr.find(x => x > ${a + b});`, `found === ${a + b + 5}`);
      }
      if (v === 'sort') {
        const arr = rng.shuffle([a, b, Math.abs(a - b) + 1, a + b]).slice(0, 4);
        const sorted = arr.slice().sort((x, y) => x - y);
        return mk(`Sort \`arr = [${arr.join(', ')}]\` ASCENDING (numbers!) into \`sorted\`. Remember the comparator!`,
          `let arr = [${arr.join(', ')}];`, `let sorted = arr.slice().sort((x, y) => x - y);`,
          `JSON.stringify(sorted) === ${JSON.stringify(JSON.stringify(sorted))}`);
      }
      if (v === 'try') {
        const raw = i % 2 ? 'not json' : `{"ok":${i + 1}}`;
        const parsed = i % 2 ? '"error"' : `data && data.ok === ${i + 1}`;
        return mk(`Parse ${JSON.stringify(raw)} safely: store the parsed result in \`data\`, or the string "error" if it throws. Use try/catch.`,
          '', `let data;\ntry { data = JSON.parse(${JSON.stringify(raw)}); } catch (e) { data = "error"; }`,
          i % 2 ? `data === "error"` : `data && data.ok === ${i + 1}`,
          'try { data = JSON.parse(...); } catch (e) { data = "error"; }');
      }
      if (v === 'closure') {
        const start = i % 5;
        return mk(`Write \`makeCounter(start)\` returning a function that increments and returns a counter beginning at \`start\`.`,
          '', `function makeCounter(start) { let n = start; return () => ++n; }`,
          `(function(){ const c = makeCounter(${start}); return c() === ${start + 1} && c() === ${start + 2}; })()`);
      }
      if (v === 'proto') {
        return mk(`Write a constructor \`Person(name)\` and add a method \`greet()\` on its PROTOTYPE that returns "Hi, I am " + name.`,
          `function Person(name) { this.name = name; }`,
          `Person.prototype.greet = function () { return "Hi, I am " + this.name; };`,
          `new Person(${JSON.stringify(name)}).greet() === ${JSON.stringify('Hi, I am ' + name)}`);
      }
      if (v === 'class') {
        return mk(`Write a class \`Point\` with constructor(x, y) and a method \`sum()\` returning x + y.`,
          '', `class Point { constructor(x, y) { this.x = x; this.y = y; } sum() { return this.x + this.y; } }`,
          `new Point(${a}, ${b}).sum() === ${a + b}`);
      }
      if (v === 'extends') {
        return mk(`Given \`class Rect\` (constructor(w, h), area() = w*h), write \`class Square extends Rect\` adding \`isSquare()\` (true when w === h). Call super(w, h).`,
          'class Rect { constructor(w, h) { this.w = w; this.h = h; } area() { return this.w * this.h; } }',
          `class Square extends Rect { constructor(w, h) { super(w, h); } isSquare() { return this.w === this.h; } }`,
          `(function(){ const s = new Square(${a}, ${a}); return s.area() === ${a * a} && s.isSquare() === true; })()`);
      }
      if (v === 'recur') {
        const k = 2 + (i % 6);
        const fact = (m) => (m <= 1 ? 1 : m * fact(m - 1));
        return mk(`Write a RECURSIVE function \`fact(n)\` computing n! (factorial). Base case: n <= 1 returns 1.`,
          '', `function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }`, `fact(${k}) === ${fact(k)}`);
      }
      if (v === 'hof') {
        const m = Math.min(n, 12);
        const digits = Array.from({ length: m }, (_, k) => k).join('');
        return mk(`Write a higher-order function \`repeat(n, fn)\` that calls \`fn(i)\` for i = 0..n-1.`,
          '', `function repeat(n, fn) { for (let i = 0; i < n; i++) fn(i); }`,
          `(function(){ let s = ""; repeat(${m}, i => s += i); return s === ${JSON.stringify(digits)}; })()`);
      }
      if (v === 'gen') {
        return mk(`Write a GENERATOR \`function* countTo(n)\` that yields 1, 2, ..., n.`,
          '', `function* countTo(n) { for (let i = 1; i <= n; i++) yield i; }`,
          `JSON.stringify([...countTo(${n})].slice(0, 3)) === "[1,2,3]" && [...countTo(${n})].length === ${n}`);
      }
      if (v === 'test') {
        return mk(`Write an \`assert(cond, msg)\` helper that throws Error("FAIL: " + msg) when cond is falsy. Then assert ${a} + ${b} === ${a + b} and store "ok" in \`done\`.`,
          '', `function assert(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); }\nassert(${a} + ${b} === ${a + b}, "math");\nlet done = "ok";`,
          `done === "ok" && (function(){ try { assert(false, "x"); return false; } catch (e) { return e.message === "FAIL: x"; } })()`);
      }
      if (v === 'todo') {
        const title = `${w}-${i}`;
        return mk(`To-do app: with \`tasks = []\`, write \`addTask("${title}")\` pushing {title, done: false}, then store \`tasks.length\` in \`count\`.`,
          'let tasks = [];',
          `function addTask(title) { tasks.push({ title, done: false }); }\naddTask(${JSON.stringify(title)});\nlet count = tasks.length;`,
          `count === 1 && tasks[0].title === ${JSON.stringify(title)} && tasks[0].done === false`);
      }
      return mk(`Write a function \`add(a, b)\` that returns a + b.`, '',
        `function add(a, b) { return a + b; }`, `add(${a}, ${b}) === ${a + b}`);
    }
    case 'arr': {
      const kinds = ['build', 'push', 'access'];
      const vals = [a, b, a + b].slice(0, 2 + (i % 2));
      return arrPractice(kinds[i % 3], vals);
    }
    case 'arrMethod': {
      const arr = [a, b, a + b];
      const kinds = ['join', 'includes', 'indexOf', 'slice'];
      return arrMethodPractice(kinds[i % 4], arr, i % 2 ? b : a + b + 99);
    }
    case 'obj': {
      const obj = i % 2 ? { name, age: 15 + (i % 20) } : { city, code: a * 10 + b };
      return objPractice(i % 2 ? 'create' : 'access', obj);
    }
    case 'tmpl':
      return tmplPractice(name, w);
    case 'coerce': {
      const exprs = [`"${a}" + ${b}`, `${a} + "${b}"`, `"${a}" - ${b}`, `Number("${a * 10}") + ${b}`, `Boolean(${i % 2})`, `"${a}" * "${b}"`];
      const vals = [`${a}${b}`, `${a}${b}`, a - b, a * 10 + b, i % 2 === 1, a * b];
      const k = i % exprs.length;
      return coercePractice(exprs[k], vals[k]);
    }
    case 'date':
      return datePractice(2020 + (i % 8), i % 12, 1 + (i % 28));
    case 'json':
      return jsonPractice(i % 2 ? { name, n: a } : { city, ok: i % 3 === 0 });
    case 'regex': {
      const pats = [['^\\d+$', String(a * 7), true], ['^\\d+$', `${w}${a}`, false], ['^a+$', 'a'.repeat(1 + (i % 4)), true], ['^a+$', 'aab', false], ['^\\w+@\\w+\\.\\w+$', `user${a}@site${b}.com`, true], ['^\\d{3}$', String(100 + (i % 900)), true]];
      const [pt, str, e] = pats[i % pats.length];
      return regexPractice(pt, str, e);
    }
    case 'dom':
      return domPractice(`${w} ${i + 1}`);
    case 'promise': {
      if (g.variant === 'async') {
        return mk(`Write an async function \`getVal()\` that awaits a promise and returns ${a + b}.`, '',
          `async function getVal() { return await Promise.resolve(${a + b}); }`,
          `(async () => (await getVal()) === ${a + b})()`);
      }
      return asyncPractice(a * 10 + b);
    }
    case 'concept': {
      const table = {
        scope: [`After \`let x = 1; { let x = ${a}; }\`, what is the outer x?`, '1'],
        destructure: [`const { a } = { a: ${a} }; what is a?`, String(a)],
        spread: [`[...[1, 2], ...[3, ${a}]] has length?`, '4'],
        callback: [`setTimeout(fn, ${a * 100}) runs fn after how many ms?`, String(a * 100)],
        timers: [`setTimeout returns?`, 'a timer id'],
        this: [`In obj.m(), this is?`, 'obj'],
        iterator: [`[..."ab"] equals?`, '["a","b"]'],
        proxy: [`The get trap intercepts?`, 'property reads'],
        eventloop: [`Promise.then callbacks are?`, 'microtasks'],
        modules: [`import comes from?`, 'another module file'],
        memory: [`Unreachable objects are?`, 'garbage collected'],
      };
      const [q, ans] = table[g.variant] || [`typeof ${a} is?`, 'number'];
      return conceptPractice(q, ans);
    }
    default:
      return logPractice(`topic ${t.id} practice ${i + 1}`);
  }
}

// ------------------------------------------------------------------ build
function escHtml(x) { return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// DEEP: per-topic extra lesson detail — common pitfalls + real-world usage.
// Keyed by topic id; lessonHtml() merges these into every lesson.
const DEEP = {
  welcome: { pitfalls: ["JavaScript is case-sensitive: Name and name are two different things.", "A missing closing quote or bracket is the most common beginner error."], real: "Every interactive website, mobile web app — and this very course app — runs on JavaScript." },
  variables: { pitfalls: ["Reassigning a const throws a TypeError at runtime.", "An undeclared assignment (x = 5 without let) creates a global in sloppy mode.", "Shadowing: an inner variable with the same name hides the outer one."], real: "Variables store everything your app remembers: scores, names, cart items, settings." },
  'data-types': { pitfalls: ["typeof null === 'object' is a historic bug that was never fixed.", "NaN === NaN is false — use Number.isNaN(x) instead of global isNaN, which coerces."], real: "APIs return JSON with mixed types; checking types prevents crashes on unexpected data." },
  numbers: { pitfalls: ["0.1 + 0.2 !== 0.3 in floating point; round before comparing or for money.", "Division by zero gives Infinity, not an error.", "Always pass the radix: parseInt(x, 10)."], real: "Prices, distances, scores and analytics all rely on correct number handling." },
  strings: { pitfalls: ["Strings are immutable: methods return a NEW string, they do not modify the original.", "Template literals need backticks, not quotes.", "Indexing past the end gives undefined, not an error."], real: "Formatting messages, building URLs and rendering text in the UI." },
  operators: { pitfalls: ["+ with a string coerces the other side: 1 + '2' is '12'.", "Use === instead of == to avoid surprise coercion.", "% keeps the sign of the dividend with negative numbers."], real: "Calculating totals, splitting bills, checking even/odd with the remainder." },
  comparison: { pitfalls: ["== coerces types ('5' == 5 is true); === does not.", "Objects and arrays compare by reference, not by value.", "0, '', null, undefined and NaN are all falsy conditions."], real: "Form validation, showing/hiding UI, game logic like 'health <= 0'." },
  'if-else': { pitfalls: ["A single = inside a condition assigns instead of comparing.", "else binds to the NEAREST if — use braces to be explicit."], real: "Grading, access control, showing different screens for different users." },
  'loops-for': { pitfalls: ["Modifying the counter inside the body changes the iteration count.", "break exits the whole loop; continue skips just one iteration.", "i++ and ++i rarely matter, but inside an expression they can."], real: "Rendering lists, processing every item in a cart, building tables." },
  'loops-while': { pitfalls: ["If the condition never becomes false you get an infinite loop — this app stops it after 3 seconds.", "do-while runs the body at least once, even when the condition is already false."], real: "Waiting for input, retrying requests, game loops that run until a condition." },
  functions: { pitfalls: ["A function without return returns undefined.", "Objects are passed by reference — mutations inside persist outside.", "Declarations are hoisted; function expressions are not."], real: "Every reusable piece of logic in every app: calculateTax(), formatDate(), sendMessage()." },
  scope: { pitfalls: ["let/const are block-scoped; var is function-scoped and leaks out of blocks.", "Inner scopes can read outer variables, never the other way round.", "Redeclaring a let in the same scope is a SyntaxError."], real: "Keeping helper variables private inside modules so nothing else can break them." },
  arrays: { pitfalls: ["Arrays are objects, but always use arr.length.", "push returns the new length, not the array.", "arr[100] on a short array creates holes (a sparse array)."], real: "Lists of products, messages, quiz questions — the most-used structure in apps." },
  objects: { pitfalls: ["Dot vs bracket notation: obj['key'] is needed when the key has spaces or comes from a variable.", "Comparing objects with === compares references, not contents.", "JSON.parse gives plain objects without methods."], real: "Storing one record — a user, a product, a setting — as key/value pairs." },
  'array-methods': { pitfalls: ["push/pop/splice MUTATE the original; concat returns a new array.", "splice changes the array in place — a classic source of bugs.", "forEach returns nothing and cannot be awaited."], real: "Transforming API data into UI lists, counting, updating carts." },
  'template-strings': { pitfalls: ["Expressions go inside ${...}; a plain $ does nothing.", "Newlines inside a template literal are real newlines in the string.", "Nested quotes inside ${} are fine, but keep it readable."], real: "Building HTML snippets, emails, messages: Hello ${name}, you have ${n} items." },
  destructuring: { pitfalls: ["const {a} = null throws — default it: function f({a} = {}) {}", "Array destructuring skips by position: const [x, , z] = arr.", "You can nest: const {user: {name}} = data."], real: "Unpacking API responses, options objects and state in one line." },
  'type-coercion': { pitfalls: ["'' + 1 is '1' but '' - 1 is 0: plus goes string, minus goes number.", "Boolean('false') is true — any non-empty string is truthy.", "Convert explicitly: Number(x), String(x), Boolean(x)."], real: "Reading form inputs and URL parameters (always strings) before using them as numbers." },
  'console-debug': { pitfalls: ["In real devtools, console.log(object) shows a live reference; here it prints JSON.", "Remove or silence logs before shipping — they can leak data.", "console.table, console.time and console.count are handy in browsers."], real: "Debugging: this is how developers see what their code is actually doing." },
  'arrow-functions': { pitfalls: ["Arrow functions have no own this — they inherit it from outside.", "A single-expression body returns automatically: x => x * 2.", "Use a normal function when you need arguments or a dynamic this."], real: "Callbacks everywhere: array methods, event handlers, promises." },
  'spread-rest': { pitfalls: ["Spread copies: const b = [...a] — mutating b does not affect a.", "With objects, later keys win: {...a, ...b}.", "Rest must come last: function sum(...nums)."], real: "Merging configs, copying arrays before sorting, collecting arguments." },
  'map-filter': { pitfalls: ["map returns a new array of the same length; filter returns only matches.", "Chaining is fine but keep it readable.", "Do not use map for side effects — use forEach."], real: "Turning raw API data into display data; showing only items matching a search." },
  reduce: { pitfalls: ["Always give an initial value, or the first element becomes the accumulator.", "reduce can build any shape: objects, strings, counts.", "For a plain sum, a for loop is often clearer."], real: "Totals, counts, grouping items by category, building objects from lists." },
  'find-some-every': { pitfalls: ["find returns the first match or undefined; some/every return booleans.", "every on an empty array is true (vacuous truth) — watch out.", "includes is cleaner than indexOf !== -1."], real: "Checking whether a user exists, whether all items are valid, finding a product by id." },
  sorting: { pitfalls: ["sort() MUTATES the original — copy first: [...arr].sort().", "Default sort is lexicographic: [10, 9].sort() gives [10, 9]! Always pass a comparator.", "Compare numbers with (a, b) => a - b."], real: "Leaderboards, prices low-to-high, latest news first." },
  'string-methods': { pitfalls: ["slice accepts negative indexes; substring swaps them instead.", "replace changes only the first match — use replaceAll or /g for all.", "trim() cleans both ends — perfect for form input."], real: "Cleaning user input, formatting phone numbers, building URL slugs." },
  json: { pitfalls: ["JSON.stringify silently drops functions, undefined and symbols.", "JSON.parse throws on invalid JSON — wrap it in try/catch.", "JSON has no Date type: dates become strings; revive them manually."], real: "Saving settings to storage, sending data to servers, reading config files." },
  dates: { pitfalls: ["Months are 0-based: January is 0, December is 11.", "new Date('2026-02-30') rolls over to March instead of erroring.", "Timestamps are milliseconds (Date.now()); seconds need / 1000."], real: "Countdowns, 'posted 3 days ago', scheduling, booking apps." },
  'try-catch': { pitfalls: ["catch catches runtime errors, not syntax errors in the same file.", "finally runs always — use it for cleanup.", "Always throw new Error(...) so you get a stack trace."], real: "Handling network failures, bad input, missing data — without crashing the app." },
  callbacks: { pitfalls: ["A callback is just a function passed to be called later.", "Deeply nested callbacks become callback hell — promises fix that.", "Always handle errors in callbacks, Node-style (err, result)."], real: "Event handlers, timers, file reads, API responses." },
  promises: { pitfalls: ["A promise settles once — later resolve/reject calls are ignored.", "Always add .catch: an unhandled rejection breaks the flow.", "Promise.all rejects fast if any input rejects; allSettled waits for all."], real: "Fetching data, joining multiple requests, every modern async API." },
  'async-await': { pitfalls: ["await only works inside an async function (or module top level).", "await looks synchronous but is still asynchronous.", "Wrap await in try/catch, or use .catch on the call."], real: "Clean sequential-looking code for loading, logging in, saving — everywhere." },
  timers: { pitfalls: ["setTimeout(fn, 0) still waits for the current code to finish.", "Always clearTimeout/clearInterval when done, or you leak.", "setInterval drifts; for precise timing, chain setTimeout."], real: "Slideshows, countdowns, debounced search input, auto-save." },
  dom: { pitfalls: ["querySelector returns the first match; querySelectorAll returns all.", "textContent is safe; innerHTML with user data is an XSS risk.", "Query elements only after the DOM exists."], real: "Everything visible in a web app: menus, lists, forms, popups." },
  regex: { pitfalls: ["With the g flag, test() is stateful (lastIndex) — reset or avoid.", "Escape special chars in dynamic patterns before building a RegExp.", "Use test() for booleans, match/replace for transforming."], real: "Validating emails and phone numbers, finding hashtags, cleaning text." },
  closures: { pitfalls: ["A closure remembers the variables of the scope where it was created.", "Loop callbacks with var share one binding — let fixes it.", "Closures can leak memory if references stay alive."], real: "Private counters and caches, factories, memoization, event handlers." },
  'this-keyword': { pitfalls: ["In a plain function call, this is undefined in strict mode (or window otherwise).", "Arrow functions inherit this — that is why they suit callbacks.", "call/apply/bind set this explicitly."], real: "Methods in objects and classes use this to reach their own data." },
  prototypes: { pitfalls: ["Methods are looked up the prototype chain until found.", "Prefer Object.prototype.hasOwnProperty.call(obj, x) over obj.hasOwnProperty(x).", "Modern code rarely touches prototypes directly — classes hide it."], real: "How objects share behaviour under the hood — the basis of classes." },
  classes: { pitfalls: ["class is sugar over prototypes; instanceof still works.", "constructor runs once per new; methods live on the prototype (memory efficient).", "Class fields are per-instance."], real: "Modeling real things — User, Product, Cart, Game — the backbone of modern apps." },
  inheritance: { pitfalls: ["extends sets up the prototype chain; super() calls the parent constructor.", "Overridden methods should call super.method() to reuse parent logic.", "Composition (objects holding objects) is often simpler than deep inheritance."], real: "Extending base types: AdminUser extends User, SavingsAccount extends Account." },
  recursion: { pitfalls: ["Every recursion needs a base case that stops the calls.", "Deep recursion can overflow the stack — iterate when depth can be huge.", "Memoize expensive recursion (fibonacci) for speed."], real: "Tree menus, nested comments, file systems, math like factorial." },
  hof: { pitfalls: ["A higher-order function takes or returns a function: map, filter, setTimeout.", "Returning functions from functions enables factories and configuration.", "Pure functions (no side effects) are easier to test."], real: "Reusable wrappers: withLogging(fn), withAuth(fn), retry(fn, 3)." },
  generators: { pitfalls: ["function* pauses at yield and resumes on next().", "Generators are lazy — nothing runs until you ask for a value.", "for...of works directly on generators."], real: "Streaming large data, infinite sequences, step-by-step wizards." },
  iterators: { pitfalls: ["An iterable has Symbol.iterator returning an iterator with next().", "Arrays, strings, Maps and Sets are all iterable.", "Custom iterables let your own objects work with for...of and spread."], real: "Uniformly looping over any collection; building custom data structures." },
  proxy: { pitfalls: ["A Proxy wraps an object and intercepts get/set/has and more.", "Use Reflect inside handlers to keep default behaviour.", "Proxies add overhead — use for validation, logging, reactive UI."], real: "Reactive frameworks, validation layers, logging, API gateways." },
  'event-loop': { pitfalls: ["JavaScript is single-threaded: one call stack, with the event loop queueing callbacks.", "Microtasks (promises) run before macrotasks (setTimeout).", "Long synchronous code blocks the UI — keep tasks short."], real: "Why setTimeout(fn, 0) runs after current code, and why the UI freezes on heavy loops." },
  modules: { pitfalls: ["import bindings are live; default export is one per module.", "Named exports can be many: export function a() {} export function b() {}.", "In this offline app code runs as a classic script; modules need a server or bundler."], real: "Splitting big apps into files: utils.js, api.js, ui.js — the real-world standard." },
  memory: { pitfalls: ["Unreferenced objects are garbage-collected automatically.", "Common leaks: forgotten timers, growing caches, detached DOM nodes, closures.", "Profile memory in real browser devtools; here, keep arrays bounded."], real: "Keeping apps fast: avoiding leaks, reusing objects, lazy-loading big data." },
  testing: { pitfalls: ["A test asserts expected behaviour: add(2, 3) must equal 5.", "Test edge cases: 0, negative, empty, huge, wrong type.", "Run tests after every change — this course does exactly that at build time."], real: "Catching bugs before users do — every serious project has automated tests." },
  'final-project': { pitfalls: ["Start small: get one feature working, then add more.", "Keep state in one place and render from it.", "Use the playground to experiment before writing the final code."], real: "You now have everything needed to build real apps — this course's runner is the same idea." },
};

function lessonHtml(t) {
  const d = DEEP[t.id] || {};
  const pit = (d.pitfalls && d.pitfalls.length ? d.pitfalls : ['Read the error message carefully — it usually names the line.', 'Change one thing at a time, run again, compare.']);
  const real = d.real || 'A core building block you will combine with other topics in real projects.';
  return `<h2>${t.n}. ${t.title}</h2>
<p class="lesson-level">${t.level}</p>
<ul class="lesson-points">${t.points.map(p => `<li>${p}</li>`).join('')}</ul>
<h3>How to do it</h3>
<ol class="lesson-steps">${t.steps.map(s => `<li>${s}</li>`).join('')}</ol>
<h3>Common pitfalls</h3>
<ul class="lesson-pitfalls">${pit.map(x => `<li>${escHtml(x)}</li>`).join('')}</ul>
<h3>Where you will use this</h3>
<p class="lesson-real">${escHtml(real)}</p>
<h3>Example</h3>
<pre class="code-block"><code>${t.example.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre>
<p class="hint">Then try the ${N_PRACTICE} practice problems below — run your code for real.</p>`;
}

function main() {
  fs.mkdirSync(path.join(OUT, 'p'), { recursive: true });
  let total = 0;
  for (const t of TOPICS) {
    if (!DEEP[t.id] || !DEEP[t.id].pitfalls || !DEEP[t.id].pitfalls.length || !DEEP[t.id].real) {
      throw new Error('topic ' + t.id + ' is missing DEEP lesson details (pitfalls/real)');
    }
  }
  const index = [];
  for (const t of TOPICS) {
    if (!/^[a-z-]+$/.test(t.id)) throw new Error('bad topic id ' + t.id);
    const practices = [];
    for (let i = 0; i < N_PRACTICE; i++) {
      const p = genFor(t, i);
      p.id = `${t.id}-p${i + 1}`;
      for (const k of ['prompt', 'starter', 'test', 'hint', 'solution']) {
        if (typeof p[k] !== 'string' || !p[k].length) throw new Error(`topic ${t.id} practice ${i}: missing ${k}`);
      }
      practices.push(p);
    }
    if (t.quiz.length < 8) throw new Error(`topic ${t.id}: needs >= 8 quiz questions`);
    for (const q of t.quiz) {
      if (!Array.isArray(q) || q.length !== 3 || !Array.isArray(q[2]) || q[2].length !== 3) throw new Error(`topic ${t.id}: bad quiz entry`);
    }
    total += practices.length;
    index.push({ id: t.id, n: t.n, level: t.level, title: t.title, lesson: lessonHtml(t), quiz: t.quiz, practices: N_PRACTICE });
    fs.writeFileSync(path.join(OUT, 'p', t.id + '.json'), JSON.stringify(practices));
  }
  fs.writeFileSync(path.join(OUT, 'topics.json'), JSON.stringify({ count: TOPICS.length, totalPractices: total, topics: index }));
  console.log(`TOPICS: ${TOPICS.length}, PRACTICES: ${total}`);
  if (TOPICS.length !== 50) { console.error('FATAL: must be exactly 50 topics'); process.exit(1); }
  if (total < 5000) { console.error('FATAL: need >= 5000 practices, have ' + total); process.exit(1); }
}
main();
