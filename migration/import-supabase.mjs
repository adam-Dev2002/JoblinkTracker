import {createClient} from '@supabase/supabase-js'
import {readFile} from 'node:fs/promises'
import {resolve,dirname,join} from 'node:path'
import {createHash} from 'node:crypto'
const [inputPath,flag]=process.argv.slice(2)
if(!inputPath){throw new Error('Usage: node --env-file=.env import-supabase.mjs PATH_TO_SNAPSHOT [--apply]')}
const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY
if(!url||!key)throw new Error('Fill migration/.env with SUPABASE_URL and SUPABASE_SECRET_KEY first.')
if(new URL(url).protocol!=='https:')throw new Error('Use your HTTPS Supabase project URL.')
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
const path=resolve(inputPath),snapshot=JSON.parse(await readFile(path,'utf8'))
if(snapshot.version!==1||!snapshot.tables)throw new Error('Invalid snapshot.')
const rows=snapshot.tables
for(const table of ['users','workspace_items','workspace_attachments']){
 if(!Array.isArray(rows[table]))throw new Error('Missing table: '+table)
 const {count,error}=await client.from(table).select('id',{count:'exact'}).limit(1)
 if(error)throw new Error('Cloud schema check failed for '+table+'. Run migration/supabase-schema.sql first.')
 if(!Number.isInteger(count))throw new Error('Cloud row count could not be verified. Nothing imported.');
 if(count!==0)throw new Error('Cloud '+table+' is not empty. Nothing imported; existing data is protected.')
 console.log(table+': '+rows[table].length+' records ready')
}
const files=[]
for(const attachment of rows.workspace_attachments){
 if(!/^[a-f0-9]{32}$/.test(attachment.stored_name))throw new Error('Invalid stored filename.')
 const metadata=snapshot.files.find(file=>file.attachment_id===attachment.id)
 if(!metadata)throw new Error('Attachment backup metadata is missing.')
 const bytes=await readFile(join(dirname(path),'files',attachment.stored_name))
 if(createHash('sha256').update(bytes).digest('hex')!==metadata.sha256||bytes.length!==metadata.size||bytes.length!==attachment.size)throw new Error('Attachment checksum mismatch. Import stopped.')
 attachment.storage_path=`${attachment.user_id}/${attachment.id}/${attachment.stored_name}`
 files.push({attachment,bytes})
}
console.log(files.length+' attachment files passed checksum verification.')
if(flag!=='--apply'){console.log('Dry run passed. Add --apply only after reviewing these counts and the target project.');process.exit(0)}
const bucket='joblink-attachments'
const {data:existing,error:lookup}=await client.storage.getBucket(bucket)
if(existing?.public)throw new Error('Attachment bucket must be private.')
if(!existing){
 if(lookup&&!/not found/i.test(lookup.message))throw new Error('Cannot inspect storage bucket.')
 const {error}=await client.storage.createBucket(bucket,{public:false,fileSizeLimit:2097152})
 if(error)throw new Error('Could not create the private attachment bucket.')
}
const uploaded=[]
try{
 for(const {attachment,bytes} of files){
  const {error}=await client.storage.from(bucket).upload(attachment.storage_path,bytes,{contentType:attachment.mime,upsert:false})
  if(error)throw new Error('Attachment upload failed. No database records were imported.')
  uploaded.push(attachment.storage_path)
 }
 const {data,error}=await client.rpc('joblink_import_snapshot',{snapshot:{version:1,tables:rows}})
 if(error)throw new Error('Atomic database import failed. Local data is unchanged; inspect the cloud SQL function setup.')
 console.log('Cloud import complete: '+JSON.stringify(data))
 console.log('IDs, account password hashes, Google identities, workspace data, and attachment bytes were preserved.')
}catch(error){
 if(uploaded.length){const {error:cleanupError}=await client.storage.from(bucket).remove(uploaded);if(cleanupError)console.error('Storage rollback incomplete. Remove only the newly uploaded object paths before retrying.')}
 throw error
}
