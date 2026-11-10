const path = require('path');
const assert = require('assert');
const supertest = require('supertest');
const app = require(path.join(path.dirname(__dirname), 'app.js'));

it('should be listening', async () => {
  await supertest(app).get('/').expect(200);
});

// Socket.IO over Node's built-in WebSocket client (no client library): "40" joins the default namespace,
// "42[event,data]" is an event. A session is one tester page: call() sends an event and resolves with the first reply.
// A spoof only lasts while its socket is open, so sessions stay open until the tests are done.
const openSessions = [];
function socketSession(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);
  let waiting = null;
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('error', reject);
    ws.addEventListener('message', frame => {
      const text = String(frame.data);
      if (text.startsWith('0')) return ws.send('40');
      if (text.startsWith('40')) return resolve();
      if (text.startsWith('42') && waiting) {
        const reply = waiting;
        waiting = null;
        reply(JSON.parse(text.slice(2)));
      }
    });
  });
  const session = {
    close: () => ws.close(),
    call: async (event, data) => {
      await ready;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out')), 3000);
        waiting = reply => { clearTimeout(timer); resolve(reply); };
        ws.send('42' + JSON.stringify([event, data]));
      });
    }
  };
  openSessions.push(session);
  return session;
}

// One call on its own new session
function socketCall(port, event, data) {
  return socketSession(port).call(event, data);
}

describe('test harness spoofing', () => {
  let port;
  before(done => {
    app.listen(0, function () { port = this.address().port; done(); });
  });
  after(() => openSessions.forEach(session => session.close()));

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
    const tester = socketSession(port);
    await tester.call('set_spoof', { callerAni: '5550000004', ani: '5551111111', dnis: '' });
    const reply = await tester.call('set_spoof', { callerAni: '5550000004', ani: '', dnis: '' });
    assert.strictEqual(reply[0], 'spoof_set');
    const res = await supertest(app).get('/spoof?ani=5550000004').expect(200);
    assert.deepStrictEqual(res.body, { found: false });
  });

  it('stops once the tester page disconnects (refresh or close)', async () => {
    const tester = socketSession(port);
    await tester.call('set_spoof', { callerAni: '5550000006', ani: '5551111111', dnis: '' });
    assert.strictEqual((await supertest(app).get('/spoof?ani=5550000006').expect(200)).body.found, true);
    tester.close();
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.deepStrictEqual((await supertest(app).get('/spoof?ani=5550000006').expect(200)).body, { found: false });
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
