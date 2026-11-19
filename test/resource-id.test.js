import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {resourceID,legacyResourceIDs} from '../server/resource-id.mjs';
test('resource IDs are portable while old Windows IDs remain addressable',()=>{
  const expected=crypto.createHash('sha1').update('operator/DynIllust/model.atlas').digest('hex').slice(0,16);
  assert.equal(resourceID('operator\\DynIllust\\model.atlas'),expected);
  assert.equal(resourceID('operator/DynIllust/model.atlas'),expected);
  assert.equal(resourceID('operator\\image.png','skin'),crypto.createHash('sha1').update('static:skin:operator/image.png').digest('hex').slice(0,16));
  assert.deepEqual(legacyResourceIDs('operator/image.png','skin'),[crypto.createHash('sha1').update('static:skin:operator\\image.png').digest('hex').slice(0,16)]);
});
