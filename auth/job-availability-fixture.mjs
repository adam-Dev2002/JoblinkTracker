// Browser tests supply known-open listings without contacting third parties.
export async function mockOpenAvailability(context) {
  await context.route('**/api/jobs/availability', route => route.fulfill({ json: {
    jobs: route.request().postDataJSON().urls.map(url => ({ url, status: 'open', checkedAt: new Date().toISOString() })),
  } }));
}
