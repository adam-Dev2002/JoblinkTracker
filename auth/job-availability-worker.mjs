// The local PHP rollback uses the same source-page checks as the deployed API.
import { availabilityUrl, checkAvailability } from '../jobfinder/preview/server/job-availability.mjs';
const chunks = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 16384) throw new Error('Request too large');
  chunks.push(chunk);
}
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
if (!Array.isArray(input.urls) || !input.urls.length || input.urls.length > 12 || input.urls.some(url => typeof url !== 'string' || url.length > 2048 || !availabilityUrl(url))) {
  process.stdout.write(JSON.stringify({ error: 'Choose up to 12 supported job listing URLs.' }));
  process.exitCode = 1;
} else process.stdout.write(JSON.stringify({ jobs: await checkAvailability([...new Set(input.urls)]) }));
