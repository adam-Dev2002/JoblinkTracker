<?php
// Read-only export. Never prints account records or credentials.
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit;
require dirname(__DIR__).'/auth/bootstrap.php';
if($configError)throw new RuntimeException('Fix local database configuration first.');
$pdo=db();$pdo->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');$pdo->beginTransaction();
$folder=dirname(__DIR__).'/.migration-data/'.gmdate('Ymd-His');
if(is_dir($folder))throw new RuntimeException('An export already exists for this second. Retry later.');
mkdir($folder.'/files',0700,true);
try {
 $tables=[];
 foreach(['users','workspace_items','workspace_attachments'] as $table){
  $query='SELECT *'.($table==='workspace_attachments'?'':', UNIX_TIMESTAMP(created_at) AS created_epoch').' FROM '.$table.' ORDER BY id';
  $rows=$pdo->query($query)->fetchAll();
  foreach($rows as &$row){$row['id']=(int)$row['id'];if(isset($row['user_id']))$row['user_id']=(int)$row['user_id'];if(isset($row['item_id']))$row['item_id']=(int)$row['item_id'];if(isset($row['created_epoch'])){$row['created_at']=gmdate('c',(int)$row['created_epoch']);unset($row['created_epoch']);}if(isset($row['email_verified']))$row['email_verified']=(bool)$row['email_verified'];if(isset($row['payload']))$row['payload']=json_decode($row['payload'],true,512,JSON_THROW_ON_ERROR);if(isset($row['size']))$row['size']=(int)$row['size'];}unset($row);
  $tables[$table]=$rows;
 }
 $files=[];
 foreach($tables['workspace_attachments'] as $row){
  if(!preg_match('/^[a-f0-9]{32}$/',$row['stored_name']))throw new RuntimeException('Unexpected stored attachment name; export stopped.');
  $source=dirname(__DIR__).'/auth/runtime/uploads/'.$row['stored_name'];if(!is_file($source))throw new RuntimeException('Missing stored attachment ID '.$row['id'].'. Export stopped; local data was not changed.');
  $destination=$folder.'/files/'.$row['stored_name'];if(!copy($source,$destination))throw new RuntimeException('Could not back up attachment.');
  $files[]=['attachment_id'=>$row['id'],'stored_name'=>$row['stored_name'],'sha256'=>hash_file('sha256',$destination),'size'=>filesize($destination)];
 }
 $snapshot=['version'=>1,'exported_at'=>gmdate('c'),'tables'=>$tables,'files'=>$files];
 file_put_contents($folder.'/snapshot.json',json_encode($snapshot,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR));
 $pdo->commit();echo "Private local export created: $folder\n";foreach($tables as $table=>$rows)echo $table.': '.count($rows)." records\n";echo 'attachments backed up: '.count($files)."\n";
}catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
