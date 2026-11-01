import test from 'node:test';
import assert from 'node:assert/strict';
import {indexPeopleById,applyIndexedPersonUpdates} from '../src/app/person-update-index.js';
test('updates preserve person object identity and do not create unknown people',()=>{
 const a={id:1,health:100,mana:10},b={id:2,health:100,mana:20};
 const people=[a,b],index=indexPeopleById(people);
 assert.equal(applyIndexedPersonUpdates(index,[{id:2,health:80},{id:777,health:0},{id:1,mana:7}]),2);
 assert.deepEqual(people,[{id:1,health:100,mana:7},{id:2,health:80,mana:20}]);
 assert.strictEqual(index.get(1),a);assert.strictEqual(index.get(2),b);
 assert.equal(people.length,2);
});
test('re-index after full world snapshot and reset never updates stale actors',()=>{
 const first=[{id:4,health:10}],lookup=indexPeopleById(first);
 const replacement=[{id:4,health:99},{id:5,health:50}],next=indexPeopleById(replacement);
 assert.equal(applyIndexedPersonUpdates(next,[{id:4,health:88}]),1);
 assert.equal(first[0].health,10);assert.equal(replacement[0].health,88);
 assert.equal(applyIndexedPersonUpdates(indexPeopleById([{id:9}]),[{id:4,health:0}]),0);
 assert.equal(lookup.get(4).health,10);
});
test('large view lookup indexes every actor once without mutating data',()=>{
 const people=Array.from({length:5000},(_,id)=>({id:id+1,x:id,health:100}));
 const index=indexPeopleById(people);
 const ids=Array.from({length:1000},(_,i)=>({id:(i*7)%5000+1,health:90}));
 assert.equal(applyIndexedPersonUpdates(index,ids),1000);
 assert.equal(index.size,5000);
 assert.equal(people.length,5000);
 assert.ok(people.some(person=>person.health===90));
});
test('invalid updates are ignored',()=>{
 const a={id:1,health:1};const idx=indexPeopleById([a]);
 assert.equal(applyIndexedPersonUpdates(idx,[undefined,null,{}, {id:'1',health:0}]),0);
 assert.equal(a.health,1);
});
