import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(Boolean).map(l=>{const i=l.indexOf('='); return [l.slice(0,i), l.slice(i+1)];}));
const key = env.GOOGLE_API_KEY;
const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
  headers: { Authorization: 'Bearer ' + key }
});
console.log('status', res.status, res.statusText);
console.log(await res.text());
