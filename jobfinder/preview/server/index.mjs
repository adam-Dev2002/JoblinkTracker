import {jobAvailability} from './job-availability-api.mjs'
import {HttpError,json} from './core.mjs'
import {auth} from './auth.mjs'
import {workspace} from './workspace.mjs'
import {jobs} from './jobs.mjs'
import {assistant} from './assistant.mjs'
export async function handleApi(request){try{const url=new URL(request.url);if(url.pathname.startsWith('/api/auth/'))return await auth(request,url);if(url.pathname.startsWith('/api/workspace/'))return await workspace(request,url);if(url.pathname==='/api/jobs/availability')return await jobAvailability(request);if(url.pathname.startsWith('/api/jobs/'))return await jobs(request,url);if(url.pathname.startsWith('/api/assistant/'))return await assistant(request,url);return json({error:'Not found.'},404)}catch(error){if(error instanceof HttpError)return json({error:error.message},error.status);console.error('Joblink cloud API request failed ('+error.name+').');return json({error:'Service is temporarily unavailable. Please try again.'},503)}}
