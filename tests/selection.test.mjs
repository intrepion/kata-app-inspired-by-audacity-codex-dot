import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionInput} from '../src/selection.js';
test('partial end typing never shifts the start boundary',()=>{assert.equal(selectionInput('1','end',5,12,12),null);assert.equal(selectionInput('10','end',5,12,12),10);});
test('empty and invalid drafts preserve selection',()=>{for(const value of ['', ' ', '-', 'NaN', 'Infinity'])assert.equal(selectionInput(value,'end',5,12,12),null);});
test('commit restores empty input and clamps bounds',()=>{assert.equal(selectionInput('','end',5,12,12,true),12);assert.equal(selectionInput('-2','start',5,12,12,true),0);assert.equal(selectionInput('99','start',5,12,12,true),12);assert.equal(selectionInput('1','end',5,12,12,true),5);assert.equal(selectionInput('99','end',5,12,12,true),12);});
test('decimals and exact clip endpoints remain valid',()=>{assert.equal(selectionInput('1.234','start',0,12,12),1.234);assert.equal(selectionInput('12.000','end',5,12,12),12);});
