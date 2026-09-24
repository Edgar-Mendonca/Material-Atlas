import fs from 'node:fs/promises';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
const input=await fs.readFile('source.css','utf8');
const result=await postcss([tailwind()]).process(input,{from:'source.css',to:'styles.css'});
await fs.writeFile('styles.css',result.css);
console.log('Built static styles.css from source.css');
