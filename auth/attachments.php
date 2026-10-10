<?php
function attachmentRequest(PDO $pdo, array $user, string $method): never {
 global $config;
 $folder=__DIR__.'/runtime/uploads';
 if($method==='GET') {
  $id=filter_var($_GET['id']??0,FILTER_VALIDATE_INT);$q=$pdo->prepare('SELECT * FROM workspace_attachments WHERE id=? AND user_id=?');$q->execute([$id,$user['id']]);$file=$q->fetch();
  if(!$file||!preg_match('/^[a-f0-9]{32}$/',$file['stored_name'])||!is_file($folder.'/'.$file['stored_name']))respond(['error'=>'Attachment not found'],404);
  header('Content-Type: '.$file['mime']);header("Content-Disposition: " . (isset($_GET['preview']) && str_starts_with($file['mime'],'image/') ? 'inline' : 'attachment') . "; filename*=UTF-8''".rawurlencode($file['name']));header('Content-Length: '.$file['size']);readfile($folder.'/'.$file['stored_name']);exit;
 }
 if($method!=='POST')respond(['error'=>'Method not allowed'],405);
 if(isset($_SERVER['HTTP_ORIGIN'])&&$_SERVER['HTTP_ORIGIN']!==$config['app_url'])respond(['error'=>'Invalid origin'],403);
 if(!hash_equals($_SESSION['csrf'],$_SERVER['HTTP_X_CSRF_TOKEN']??''))respond(['error'=>'Session expired. Refresh and try again.'],403);
 $row=filter_var($_POST['itemId']??0,FILTER_VALIDATE_INT);$q=$pdo->prepare("SELECT id FROM workspace_items WHERE id=? AND user_id=? AND kind='sheet'");$q->execute([$row,$user['id']]);if(!$q->fetch())respond(['error'=>'Sheet row not found'],404);
 $files=$_FILES['files']??null;if(!$files||!is_array($files['name'])||count($files['name'])>3)respond(['error'=>'Choose up to 3 files, 2 MB each.'],422);
 $q=$pdo->prepare('SELECT COUNT(*) FROM workspace_attachments WHERE item_id=?');$q->execute([$row]);if((int)$q->fetchColumn()+count($files['name'])>10)respond(['error'=>'A row supports up to 10 attachments.'],422);
 $q=$pdo->prepare('SELECT COALESCE(SUM(size),0) FROM workspace_attachments WHERE user_id=?');$q->execute([$user['id']]);$quota=(int)$q->fetchColumn();$prepared=[];$types=['image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain','text/csv','application/csv','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
 foreach($files['name'] as $index=>$name){
  if($files['error'][$index]!==UPLOAD_ERR_OK||$files['size'][$index]>2097152||$files['size'][$index]<1)respond(['error'=>'Each file must upload successfully and be under 2 MB.'],422);
  $tmp=$files['tmp_name'][$index];$mime=(new finfo(FILEINFO_MIME_TYPE))->file($tmp);$ext=strtolower(pathinfo($name,PATHINFO_EXTENSION));
  if(in_array($ext,['docx','xlsx'],true)){ $zip=new ZipArchive();if($zip->open($tmp)!==true||$zip->locateName('[Content_Types].xml')===false||$zip->locateName($ext==='docx'?'word/document.xml':'xl/workbook.xml')===false)respond(['error'=>'Invalid Office document.'],422);$zip->close();$mime=$ext==='docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; }
  if(!in_array($mime,$types,true)||!in_array($ext,['png','jpg','jpeg','webp','gif','pdf','txt','csv','docx','xlsx'],true))respond(['error'=>'Supported: images, PDF, TXT, CSV, DOCX and XLSX.'],422);
  if(str_starts_with($mime,'image/')&&!getimagesize($tmp))respond(['error'=>'Invalid image.'],422);
  $quota+=$files['size'][$index];if($quota>104857600)respond(['error'=>'Account attachment limit reached (100 MB).'],422);
  $prepared[]=['tmp'=>$tmp,'stored'=>bin2hex(random_bytes(16)),'name'=>mb_substr(basename(str_replace('\\','/',$name)),0,200),'mime'=>$mime,'size'=>$files['size'][$index]];
 }
 if(!is_dir($folder))mkdir($folder,0700,true);$moved=[];$result=[];$pdo->beginTransaction();
 try{foreach($prepared as $file){$path=$folder.'/'.$file['stored'];if(!move_uploaded_file($file['tmp'],$path))throw new RuntimeException('Upload failed');$moved[]=$path;$pdo->prepare('INSERT INTO workspace_attachments (user_id,item_id,name,stored_name,mime,size) VALUES (?,?,?,?,?,?)')->execute([$user['id'],$row,$file['name'],$file['stored'],$file['mime'],$file['size']]);$result[]=['id'=>(int)$pdo->lastInsertId(),'name'=>$file['name'],'mime'=>$file['mime'],'size'=>(int)$file['size']];}$pdo->commit();}catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();foreach($moved as $path)unlink($path);throw $e;}
 respond(['attachments'=>$result],201);
}
function removeAttachmentFiles(PDO $pdo, int $userId, array $ids): void {
 if(!$ids)return;$marks=implode(',',array_fill(0,count($ids),'?'));$q=$pdo->prepare("SELECT stored_name FROM workspace_attachments WHERE user_id=? AND item_id IN ($marks)");$q->execute(array_merge([$userId],$ids));foreach($q->fetchAll() as $file)if(preg_match('/^[a-f0-9]{32}$/',$file['stored_name'])){ $path=__DIR__.'/runtime/uploads/'.$file['stored_name'];if(is_file($path))unlink($path);}
}
