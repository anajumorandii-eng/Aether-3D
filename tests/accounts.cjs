const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const run=Date.now().toString(36);
async function login(page,email){await page.evaluate(async email=>{const {auth}=await import('/src/account/firebase.ts');const {signInWithCredential,GoogleAuthProvider}=await import('/node_modules/.vite/deps/firebase_auth.js');const token=JSON.stringify({sub:email,email,email_verified:true,name:email.split('@')[0]});await signInWithCredential(auth,GoogleAuthProvider.credential(token));},email);}
(async()=>{const b=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,args:['--no-sandbox']});const ca=await b.newContext({viewport:{width:390,height:844}});const cb=await b.newContext({viewport:{width:820,height:1180}});const a=await ca.newPage(),c=await cb.newPage();const errors=[];for(const p of [a,c])p.on('pageerror',e=>errors.push(e.message));
for(const p of [a,c])await p.goto(process.env.ACCOUNT_TEST_URL || 'http://127.0.0.1:5175');
await login(a,`sync-${run}@example.test`);await a.getByRole('button',{name:'Conta Aether'}).click();await a.getByText('Sincronizado',{exact:true}).waitFor();await a.getByRole('button',{name:'Fechar',exact:true}).click();
await login(c,`sync-${run}@example.test`);await c.getByRole('button',{name:'Conta Aether'}).click();await c.getByText('Sincronizado',{exact:true}).waitFor();await c.getByRole('button',{name:'Fechar',exact:true}).click();
console.log('Two sessions signed in');
const modes=p=>p.getByRole('group',{name:'Modos de escuta'});
await modes(a).getByRole('button',{name:'Graves',exact:true}).click();await c.waitForFunction(()=>document.querySelector('[aria-label="Modos de escuta"] button[aria-pressed="true"]')?.textContent.trim()==='Graves');console.log('Sound mode synced');
await a.getByRole('button',{name:'Personalizar',exact:true}).click();await a.getByLabel('Salvar como meu modo').fill('Compartilhado');await a.getByRole('button',{name:'Salvar modo',exact:true}).click();await c.getByRole('button',{name:'Compartilhado',exact:true}).waitFor();console.log('Custom mode synced');
await c.reload();await c.getByRole('button',{name:'Compartilhado',exact:true}).waitFor();console.log('Reload restored account');
await c.getByRole('button',{name:'Conta Aether'}).click();await c.getByRole('button',{name:'Sair da conta',exact:true}).click();await c.getByRole('button',{name:'Entrar com Google'}).waitFor();await c.getByRole('button',{name:'Fechar',exact:true}).click();assert.equal(await c.getByRole('button',{name:'Compartilhado',exact:true}).count(),0);console.log('Signout restored guest settings');
await login(c,`other-${run}@example.test`);await c.getByRole('button',{name:'Conta Aether'}).click();await c.getByText('Sincronizado',{exact:true}).waitFor();await c.getByRole('button',{name:'Fechar',exact:true}).click();assert.equal(await c.getByRole('button',{name:'Compartilhado',exact:true}).count(),0);console.log('New account isolated');
assert.deepEqual(errors,[]);console.log('No runtime errors');await b.close();})();
