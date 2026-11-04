"""Exclusive local Docker integration; no existing database is restarted or reused."""
from pathlib import Path
import hashlib
import json
import os
import secrets
import signal
import socket
import subprocess
import time
import urllib.error
import urllib.request

MYSQL = 'sha256:8eccfc5e5aebbf3a49375b13956a88cd244d13ac6b25b52dec792b7526363b19'
MONGO = 'sha256:0010f63d26952bd3960fac5513c64a1cf7d6299f31fa7b54ac1b36633ee04333'
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()


def save(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write(json.dumps(value, indent=2) + '\n')


def private(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write(value)


def run_runtime(config, output_dir, chain):
    from importlib.util import spec_from_file_location, module_from_spec
    specification = spec_from_file_location('release_execution_inventory', Path(__file__).with_name('v1-release-execute.py'))
    executor = module_from_spec(specification); specification.loader.exec_module(executor)
    assert chain in ['js', 'bc']
    output = Path(output_dir)
    output.mkdir(mode=0o700, parents=True)
    bundle = Path(config['bundle'])
    bank = bundle / 'bank'
    work = bank / '.scratch/p26-p32-bank-v1-59o__arv'
    buildfile = work / 'builds' / chain / 'BUILD.json'
    build = json.loads(buildfile.read_text())
    def verify_build_bytes():
        for value, expected in build['classpathInventory'].items():
            p = Path(value)
            if isinstance(expected, str): assert sha(p) == expected
            elif expected.get('absent'): assert not p.exists()
            else: assert executor.inventory(p) == expected
        assert executor.inventory(Path(build['target']), ['target','project/target','project/project/target','.bsp','.bloop']) == build['source']['generated']
    verify_build_bytes()
    target = Path(build['target'])
    java = Path(config['javaHome']) / 'bin/java'
    node = bundle / 'node/bin/node'
    settings = config['runtime']
    module = Path(settings['browserModule']); browserexe = Path(settings['browserExecutable'])
    assert module.is_file() and browserexe.is_file()
    docker = settings.get('docker', '/usr/local/bin/docker')
    assert settings['mysqlImage'] == MYSQL and settings['mongoImage'] == MONGO
    import re
    commands = []
    def safe_diagnostic(data):
        text = data.decode(errors='replace')
        return {'errorNumbers': re.findall(r'ERROR\s+(\d+)\s*\(([A-Z0-9]+)\)', text), 'connectionFailed': any(s in text for s in ["Can't connect", 'Connection refused', 'not running']), 'bytes': len(data)}
    containers = {}
    owner = 'bank-release-' + config['workId'] + '-' + chain
    assert len(owner) < 90 and all(c.isalnum() or c in '-_' for c in owner)
    env = {'HOME': str(output), 'JAVA_HOME': str(java.parent.parent), 'PATH': str(java.parent)+':/usr/local/bin:/usr/bin:/bin', 'LANG': 'en_US.UTF-8', 'TRUTHSRC_ROOT': str(bundle/'js-generator'), 'GIT_CEILING_DIRECTORIES': str(bundle)}

    def cmd(args, stdin=None, check=True, timeout=60):
        p = subprocess.Popen([docker, *args], stdin=subprocess.PIPE if stdin else subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            out, err = p.communicate(stdin.encode() if stdin else None, timeout=timeout)
        except subprocess.TimeoutExpired:
            p.terminate()
            try: out, err = p.communicate(timeout=10)
            except subprocess.TimeoutExpired: p.kill(); out, err = p.communicate()
            raise RuntimeError('Docker command timed out')
        commands.append({'argv':[docker,*args], 'pid':p.pid,'waited':True,'exitCode':p.returncode,'stdoutSha256':hashlib.sha256(out).hexdigest(),'stderrSha256':hashlib.sha256(err).hexdigest(),'diagnostic':safe_diagnostic(err)})
        command_dir = output/'commands'; command_dir.mkdir(exist_ok=True)
        index = str(len(commands)-1)
        private(command_dir/(index+'.stdout.log'), out.decode(errors='replace'))
        private(command_dir/(index+'.stderr.log'), err.decode(errors='replace').replace(rootpass,'[redacted]').replace(apppass,'[redacted]'))
        commands[-1]['retainedStdout']={'file':str(command_dir/(index+'.stdout.log')),'sha256':sha(command_dir/(index+'.stdout.log'))}
        commands[-1]['retainedStderr']={'file':str(command_dir/(index+'.stderr.log')),'sha256':sha(command_dir/(index+'.stderr.log'))}
        if check and p.returncode != 0:
            raise RuntimeError('Docker command failed without exposing diagnostics containing credentials')
        return p.returncode, out.decode()

    def spawn_wait(argv, root, childenv, seconds):
        with (root/'stdout.log').open('xb') as out, (root/'stderr.log').open('xb') as err:
            p = subprocess.Popen(list(map(str,argv)),cwd=target,env=childenv,stdin=subprocess.DEVNULL,stdout=out,stderr=err)
            timed=False
            try: code=p.wait(timeout=seconds)
            except subprocess.TimeoutExpired:
                timed=True;p.terminate()
                try:code=p.wait(timeout=10)
                except subprocess.TimeoutExpired:p.kill();code=p.wait()
        record={'argv':list(map(str,argv)),'pid':p.pid,'exitCode':code,'waited':True,'timedOut':timed,'logs':{n:{'file':str(root/n),'sha256':sha(root/n)} for n in ['stdout.log','stderr.log']}}
        save(root/'process.json',record)
        assert code==0 and not timed, 'child failed; private logs retained'
        return record

    rootpass = secrets.token_hex(32)
    apppass = secrets.token_hex(32)
    private(output/'mysql-root', rootpass)
    private(output/'mysql-client.cnf', '[client]\nuser=root\npassword='+rootpass+'\n')
    private(output/'mysql-app', apppass)
    runs = []
    failed = None
    old_handlers = {}
    def cancelled(sig, frame):
        raise InterruptedError('runtime cancelled')
    for sig in [signal.SIGTERM,signal.SIGINT]: old_handlers[sig]=signal.signal(sig,cancelled)
    try:
        for kind,image,port,destination in [('mysql',MYSQL,3306,'/var/lib/mysql'),('mongo',MONGO,27017,'/data/db')]:
            assert cmd(['image','inspect',image,'--format','{{.Id}}'])[1].strip()==image
            data=output/(kind+'-data');data.mkdir()
            args=['run','-d','--pull=never','--name',owner+'-'+kind,'--label','bank.owner='+owner,'--publish',f'127.0.0.1::{port}','--mount',f'type=bind,src={data},dst={destination}']
            if kind=='mysql': args += ['--mount',f'type=bind,src={output/"mysql-root"},dst=/run/secrets/mysql-root,readonly','--mount',f'type=bind,src={output/"mysql-client.cnf"},dst=/run/secrets/mysql-client.cnf,readonly','-e','MYSQL_ROOT_PASSWORD_FILE=/run/secrets/mysql-root','-e','MYSQL_ROOT_HOST=%']
            args += [image]
            if kind=='mongo': args += ['--bind_ip_all']
            ident=cmd(args)[1].strip();assert len(ident)==64;containers[kind]=ident
            deadline=time.monotonic()+160
            probe=['exec',ident,'mysql','--defaults-extra-file=/run/secrets/mysql-client.cnf','--protocol=TCP','--host=127.0.0.1','--port=3306','--batch','--skip-column-names','-e','SELECT 1'] if kind=='mysql' else ['exec',ident,'mongo','--quiet','--eval','db.adminCommand({ping:1}).ok']
            while cmd(probe,check=False)[0]!=0:
                assert time.monotonic()<deadline,'database readiness timeout';time.sleep(.5)
        ports={}
        for kind,ident in containers.items():
            assert cmd(['inspect',ident,'--format','{{index .Config.Labels "bank.owner"}} {{.State.Running}}'])[1].strip()==owner+' true'
            port='3306/tcp' if kind=='mysql' else '27017/tcp'
            rows=json.loads(cmd(['inspect',ident,'--format','{{json .NetworkSettings.Ports}}'])[1])[port]
            assert len(rows)==1 and rows[0]['HostIp']=='127.0.0.1';ports[kind]=int(rows[0]['HostPort'])
        namespace='release_'+config['workId']+'_'+chain
        schema=namespace; replay=schema+'_replay'
        sql=f"CREATE DATABASE `{schema}` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; CREATE DATABASE `{replay}` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; CREATE USER 'bank_release'@'%' IDENTIFIED BY '{apppass}'; GRANT ALL PRIVILEGES ON `{schema}`.* TO 'bank_release'@'%'; GRANT ALL PRIVILEGES ON `{replay}`.* TO 'bank_release'@'%';"
        cmd(['exec','-i',containers['mysql'],'mysql','--defaults-extra-file=/run/secrets/mysql-client.cnf'],sql)
        ta=output/'ta';ta.mkdir()
        issued={p:{'token':secrets.token_hex(24),'csrf':secrets.token_hex(24)} for p in ['customer','collection','operator']}
        for mode in ['initial','restart','refund','replay']:
            run=output/mode;run.mkdir(mode=0o700)
            with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            origin=f'http://127.0.0.1:{port}'
            principals=[{'id':p,'accountId':p,'roles':['operator' if p=='operator' else 'customer'],'token':issued[p]['token'],'csrfToken':issued[p]['csrf']} for p in issued]
            conf={'service.test-tier':'database-integration','bank.namespace':namespace,'bank.integration.httpPort':port,'bank.demo.authMode':'fixed-local-demo','bank.demo.version':'bank-release-demo-v1','bank.demo.origin':origin,'bank.demo.principals':principals,'bank.demo.funds':[{'code':'fund','collectionAccountId':'collection'}],'bank.demo.seeds':[{'accountId':p,'minorUnits':'100000' if p=='customer' else '0'} for p in issued],'bank.mockTa.node':str(node),'bank.mockTa.worker':str(bank/'tools/v1-service-mock-ta-worker.mjs'),'bank.mockTa.ownedRoot':str(ta),'bank.mockTa.journal':str(ta/'journal.jsonl'),'bank.mockTa.transcript':str(ta/('worker-'+mode+'.jsonl')),'bank.mockTa.stderr':str(ta/('worker-'+mode+'.stderr.log')),'bank.mockTa.scenario':'rejected' if mode=='refund' else 'confirmed','bank.recovery.authorization':'release-local-machine-only','akka.actor.provider':'local','akka.remote.artery.canonical.port':0,'akka.remote.artery.canonical.hostname':'127.0.0.1','akka.loglevel':'INFO','play.server.pidfile.path':'/dev/null'}
            private(run/'integration.conf','\n'.join(k+' = '+json.dumps(v) for k,v in conf.items())+'\n')
            private(run/'browser-config.mjs','export default '+json.dumps({'synthetic':True,'baseURL':origin,'mode':mode,'credentials':issued})+';\n')
            childenv={**env,'PLAY_SECRET':secrets.token_hex(32),'MONGO_URI':f'mongodb://127.0.0.1:{ports["mongo"]}/{namespace}','MYSQL_JDBC_URL':f'jdbc:mysql://127.0.0.1:{ports["mysql"]}/{replay if mode=="replay" else schema}?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC','MYSQL_USER':'bank_release','MYSQL_PASSWORD':apppass}
            argv=[java,'-Xmx1G','-cp',':'.join(build['classpath']),'example.bankwealth.service.BankProductionHttpMain',run,run/'integration.conf']
            server=None
            try:
                with (run/'server.stdout.log').open('xb') as out,(run/'server.stderr.log').open('xb') as err:
                    server=subprocess.Popen(list(map(str,argv)),cwd=target,env=childenv,stdin=subprocess.DEVNULL,stdout=out,stderr=err)
                deadline=time.monotonic()+90
                while not (run/'server.json').exists():
                    assert server.poll() is None and time.monotonic()<deadline,'production server failed readiness';time.sleep(.2)
                while True:
                    try:
                        req=urllib.request.Request(origin+'/api/v1/accounts/me',headers={'Authorization':'Bearer '+issued['customer']['token']})
                        with urllib.request.urlopen(req,timeout=5) as response:view=json.load(response)
                        if view.get('account') and view.get('metadata',{}).get('disposition')=='caught-up':break
                    except (urllib.error.URLError,TimeoutError):pass
                    assert server.poll() is None and time.monotonic()<deadline,'projection readiness timeout';time.sleep(.3)
                browser=run/'browser';browser.mkdir()
                process=spawn_wait([node,bank/'tools/v1-browser-funds.mjs','--config',run/'browser-config.mjs','--browser-module',module,'--browser-executable',browserexe],browser,env,200)
                report=json.loads((browser/'stdout.log').read_text());assert report['completed'] and report['mode']==mode
            finally:
                if server and server.poll() is None:
                    private(run/'stop','stop\n')
                    try:server.wait(timeout=65)
                    except subprocess.TimeoutExpired:
                        server.terminate()
                        try:server.wait(timeout=10)
                        except subprocess.TimeoutExpired:server.kill();server.wait()
                save(run/'server-process.json',{'argv':list(map(str,argv)),'pid':server.pid if server else None,'exitCode':server.returncode if server else None,'waited':server is not None and server.poll() is not None,'closed':(run/'closed.json').exists(),'logs':{n:{'file':str(run/n),'sha256':sha(run/n)} for n in ['server.stdout.log','server.stderr.log'] if (run/n).exists()}})
            assert server.returncode==0 and json.loads((run/'closed.json').read_text())['closed']
            verify_build_bytes()
            worker_rows = [json.loads(line) for line in (ta/('worker-'+mode+'.jsonl')).read_text().splitlines() if line]
            starts=[r for r in worker_rows if r.get('kind')=='worker-started']; exits=[r for r in worker_rows if r.get('kind')=='worker-exited']
            assert len(starts)==len(exits)==1 and starts[0]['pid']==exits[0]['pid'] and exits[0]['waited'] and exits[0]['exitCode']==0
            runs.append({'mode':mode,'process':process,'serverReceipt':{'file':str(run/'server-process.json'),'sha256':sha(run/'server-process.json')},'report':report,'workerLog':{'file':str(ta/('worker-'+mode+'.jsonl')),'sha256':sha(ta/('worker-'+mode+'.jsonl'))}})
        initial,restart,refund,replayed=[r['report'] for r in runs]
        assert initial['original']==restart['original']==replayed['orders'][0]['original']
        assert refund['original']==replayed['orders'][1]['original']
        for role in ['customer','collection']:
            assert initial['accounts'][role]['account']==refund['accounts'][role]['account']==replayed['accounts'][role]['account']
        neg=output/'mysql-negative';neg.mkdir()
        negprocess=spawn_wait([java,'-Xmx1G','-cp',':'.join(build['classpath']),'example.bankwealth.service.BankMysqlNegativeMain',neg,f'jdbc:mysql://127.0.0.1:{ports["mysql"]}',output/'mysql-root'],neg,env,180)
        negative=json.loads((neg/'result.json').read_text());assert len(negative['scenarios'])==5 and all(r['status']=='passed' for r in negative['scenarios'])
    except BaseException as error:
        failed=type(error).__name__
        raise
    finally:
        cleanup=[]
        for kind,ident in containers.items():
            own=cmd(['inspect',ident,'--format','{{index .Config.Labels "bank.owner"}}'],check=False)[1].strip()
            if own==owner:
                code,_=cmd(['stop','--time','20',ident],check=False,timeout=40)
                running=cmd(['inspect',ident,'--format','{{.State.Running}}'],check=False)[1].strip()
                cleanup.append({'kind':kind,'id':ident,'stopExit':code,'stopped':running=='false','dataPreserved':True})
        for sig,handler in old_handlers.items():signal.signal(sig,handler)
        save(output/'RESULT.json',{'schemaVersion':'bank-release-runtime/v2','chain':chain,'buildReceipt':{'file':str(buildfile),'sha256':sha(buildfile)},'passed':failed is None and len(runs)==4 and all(c['stopped'] for c in cleanup),'failure':failed,'runs':runs,'mysqlNegative':negative if 'negative' in locals() else None,'mysqlProcess':negprocess if 'negprocess' in locals() else None,'mysqlEvidence':executor.inventory(output/'mysql-negative') if (output/'mysql-negative').exists() else {},'commands':commands,'cleanup':cleanup,'imageVersions':{'mysql':MYSQL,'mongo':MONGO},'productionFactoryMongoMySql':True,'modernMongoCompatible':False,'mongo44Eol':True,'releaseAccepted':False})
