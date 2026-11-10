const path = require('path');
const assert = require('assert');
const supertest = require('supertest');
const app = require(path.join(path.dirname(__dirname), 'app.js'));

it('should be listening', async () => {
  await supertest(app).get('/').expect(200);
});

// Socket.IO over Node's built-in WebSocket client (no client library): "40" joins the default namespace,
// "42[event,data]" is an event. Resolves with the first reply to `event`.
function socketCall(port, event, data) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);
    const timer = setTimeout(() => { ws.close(); reject(new Error('timed out')); }, 3000);
    ws.addEventListener('error', reject);
    ws.addEventListener('message', frame => {
      const text = String(frame.data);
      if (text.startsWith('0')) return ws.send('40');
      if (text.startsWith('40')) return ws.send('42' + JSON.stringify([event, data]));
      if (text.startsWith('42')) {
        clearTimeout(timer);
        ws.close();
        resolve(JSON.parse(text.slice(2)));
      }
    });
  });
}

describe('test harness spoofing', () => {
  let port;
  before(done => {
    app.listen(0, function () { port = this.address().port; done(); });
  });

  it('returns found:false when nothing is set', async () => {
    const res = await supertest(app).get('/spoof?ani=5550000001').expect(200);
    assert.deepStrictEqual(res.body, { found: false });
  });

  it('returns what a tester set, looked up by their real ANI', async () => {
    const reply = await socketCall(port, 'set_spoof', { callerAni: '5550000002', ani: '(555) 123-4567', dnis: '+18005551212' });
    assert.deepStrictEqual(reply, ['spoof_set', { callerAni: '5550000002', ani: '5551234567', dnis: '+18005551212' }]);

    const res = await supertest(app).get('/spoof?ani=5550000002').expect(200);
    assert.deepStrictEqual(res.body, { found: true, ani: '5551234567', dnis: '+18005551212' });
  });

  it('matches a +1 caller ANI, including a "+" that arrived as a space', async () => {
    await socketCall(port, 'set_spoof', { callerAni: '5550000003', ani: '5559998888', dnis: '' });
    for (const query of ['%2B15550000003', '+15550000003']) {
      const res = await supertest(app).get('/spoof?ani=' + query).expect(200);
      assert.deepStrictEqual(res.body, { found: true, ani: '5559998888', dnis: '' });
    }
  });

  it('clears when both are blank', async () => {
    await socketCall(port, 'set_spoof', { callerAni: '5550000004', ani: '5551111111', dnis: '' });
    const reply = await socketCall(port, 'set_spoof', { callerAni: '5550000004', ani: '', dnis: '' });
    assert.strictEqual(reply[0], 'spoof_set');
    const res = await supertest(app).get('/spoof?ani=5550000004').expect(200);
    assert.deepStrictEqual(res.body, { found: false });
  });

  it('rejects values that are not phone numbers', async () => {
    for (const bad of [{ callerAni: '5550000005', ani: 'abc', dnis: '' }, { callerAni: '', ani: '5551111111', dnis: '' }, { callerAni: '5550000005', ani: 5551111111, dnis: '' }]) {
      const reply = await socketCall(port, 'set_spoof', bad);
      assert.deepStrictEqual(reply, ['spoof_failure']);
    }
    const res = await supertest(app).get('/spoof?ani=5550000005').expect(200);
    assert.deepStrictEqual(res.body, { found: false });
  });

  it('does not match a different caller or a missing ani', async () => {
    assert.deepStrictEqual((await supertest(app).get('/spoof?ani=5550009999').expect(200)).body, { found: false });
    assert.deepStrictEqual((await supertest(app).get('/spoof').expect(200)).body, { found: false });
  });
});
