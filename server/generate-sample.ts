import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sampleDraft } from './sample.js';
import { buildXml } from './xml.js';

writeFileSync(resolve(process.cwd(), 'sample-entry.xml'), `${buildXml(sampleDraft)}\n`, 'utf8');
console.log('Wrote sample-entry.xml');
