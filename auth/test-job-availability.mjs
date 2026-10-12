import assert from 'node:assert/strict';
import { isClosedListing, hasClosureNotice } from '../jobfinder/preview/scripts/job-availability.mjs';

const now = Date.parse('2026-10-12T12:00:00Z');
for (const row of [{ status: 'closed' }, { jobStatus: 'filled' }, { availability: 'expired' }, { active: false }, { job_is_expired: true }, { totalJobOpenings: 0 }, { validThrough: '2026-10-11' }, { job_offer_expiration_datetime_utc: '2026-10-12T11:00:00Z' }, { title: '[CLOSED] Assistant' }, { description: 'This job has been closed.' }, { title: 'This advert is closed to new applicants' }, { content: 'The position has already been filled.' }, { description: 'This job is full.' }]) assert.equal(isClosedListing(row, now), true, JSON.stringify(row));
for (const row of [{ title: 'Full-time Full Stack Developer' }, { description: 'Review closed tickets and fill customer forms.' }, { validThrough: '2026-10-12' }, { validThrough: 'bad date' }, { status: 'active' }]) assert.equal(isClosedListing(row, now), false, JSON.stringify(row));
assert.equal(hasClosureNotice('We are no longer accepting applications.'), true);
assert.equal(isClosedListing({ title: 'Director – POSITION FILLED (Keeping for future roles)' }, now), true);
assert.equal(hasClosureNotice('<p>Role Overview</p><p>Position Filled</p><p>We are a brand.</p>'), true);
assert.equal(hasClosureNotice('Accepting applications until the position is filled.'), false);
assert.equal(hasClosureNotice('Follow up maintenance work orders until the job is closed.'), false);
assert.equal(isClosedListing({ description: 'We need the above mentioned position filled by an ambitious individual.' }, now), false);
assert.equal(isClosedListing({ availability: 'unknown' }, now), false);
console.log('PASS: local closure metadata and expiry filtering without network checks.');
