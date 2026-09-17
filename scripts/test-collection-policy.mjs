import assert from 'node:assert/strict';
import { normalizeCollectionRequirements, collectionProgress } from '../lib/collection-policy.ts';
assert.deepEqual(normalizeCollectionRequirements(['A','A',{name:'B',quantity:2}]), [{name:'A',quantity:2},{name:'B',quantity:2}]);
assert.deepEqual(collectionProgress([{name:'A',quantity:2},{name:'B',quantity:1}], ['A','A','B']), {matched:3,total:3,progress:1,completed:true});
assert.deepEqual(collectionProgress([{name:'A',quantity:2}], ['A']), {matched:1,total:2,progress:.5,completed:false});
assert.equal(collectionProgress([], []).completed, false);
console.log('collection-policy: PASS');
