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
  // Resolves with the next event the server sends, whether or not we asked for it
  const next = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), 3000);
    waiting = reply => { clearTimeout(timer); resolve(reply); };
  });
  const session = {
    close: () => ws.close(),
    next,
    call: async (event, data) => {
      await ready;
      const reply = next();
      ws.send('42' + JSON.stringify([event, data]));
      return reply;
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

  it('a new spoof for the same number replaces the one in another tab, and that tab is told', async () => {
    const oldTab = socketSession(port);
    await oldTab.call('set_spoof', { callerAni: '5550000007', ani: '5551111111', dnis: '' });
    const told = oldTab.next();
    const newTab = socketSession(port);
    const reply = await newTab.call('set_spoof', { callerAni: '5550000007', ani: '5552222222', dnis: '' });
    assert.deepStrictEqual(reply, ['spoof_set', { callerAni: '5550000007', ani: '5552222222', dnis: '' }]);
    assert.deepStrictEqual(await told, ['spoof_replaced', { callerAni: '5550000007' }]);
    const res = await supertest(app).get('/spoof?ani=5550000007').expect(200);
    assert.deepStrictEqual(res.body, { found: true, ani: '5552222222', dnis: '' });
  });

  it('closing the replaced tab later leaves the new spoof alone', async () => {
    const oldTab = socketSession(port);
    await oldTab.call('set_spoof', { callerAni: '5550000008', ani: '5551111111', dnis: '' });
    const told = oldTab.next();
    await socketSession(port).call('set_spoof', { callerAni: '5550000008', ani: '5552222222', dnis: '' });
    await told;
    const res = await supertest(app).get('/spoof?ani=5550000008').expect(200);
    assert.deepStrictEqual(res.body, { found: true, ani: '5552222222', dnis: '' });
    oldTab.close();
    await new Promise(resolve => setTimeout(resolve, 300));
    const after = await supertest(app).get('/spoof?ani=5550000008').expect(200);
    assert.deepStrictEqual(after.body, { found: true, ani: '5552222222', dnis: '' });
  });

  it('clearing in one tab also removes the spoof another tab had', async () => {
    const oldTab = socketSession(port);
    await oldTab.call('set_spoof', { callerAni: '5550000009', ani: '5551111111', dnis: '' });
    const told = oldTab.next();
    await socketSession(port).call('set_spoof', { callerAni: '5550000009', ani: '', dnis: '' });
    assert.deepStrictEqual(await told, ['spoof_replaced', { callerAni: '5550000009' }]);
    const res = await supertest(app).get('/spoof?ani=5550000009').expect(200);
    assert.deepStrictEqual(res.body, { found: false });
  });

  it('get_spoof shows what another tab already has for a number', async () => {
    await socketSession(port).call('set_spoof', { callerAni: '5550000010', ani: '5551111111', dnis: '+18005551212' });
    const reply = await socketSession(port).call('get_spoof', '+15550000010');
    assert.deepStrictEqual(reply, ['spoof_current', { callerAni: '5550000010', ani: '5551111111', dnis: '+18005551212' }]);
    const none = await socketSession(port).call('get_spoof', '5550000011');
    assert.deepStrictEqual(none, ['spoof_current', { callerAni: '5550000011', ani: '', dnis: '' }]);
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
