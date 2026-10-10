import type { APIRoute } from 'astro'
import { handleApi } from '../../server/index.mjs'
export const prerender = false
export const ALL: APIRoute = ({request}) => handleApi(request)
