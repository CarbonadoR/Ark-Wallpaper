import crypto from 'node:crypto';
// Resource IDs are a wire format: use the same separators on every platform.
export function resourceID(relative,source){
  const canonical=relative.replaceAll('\\','/');
  return crypto.createHash('sha1').update(source?`static:${source}:${canonical}`:canonical).digest('hex').slice(0,16);
}
export function legacyResourceIDs(relative,source){
  const windows=relative.replaceAll('/','\\');
  return [crypto.createHash('sha1').update(source?`static:${source}:${windows}`:windows).digest('hex').slice(0,16)];
}
