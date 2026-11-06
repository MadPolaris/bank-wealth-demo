"""Portable, exclusive release execution; old receipts are never rewritten."""
from pathlib import Path
import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time

BANK = Path(__file__).resolve().parents[1]
EXCLUDED = {'target', '.git', '.scratch', 'node_modules', '__pycache__', '.bloop', '.bsp'}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def plain(value, fresh=False):
    p = Path(value)
    if not p.is_absolute() or str(p.resolve()) != str(p) or any(c in str(p) for c in '\n\r\0:'):
        raise ValueError('canonical absolute path without classpath separators required')
    if fresh:
        if p.exists() or p.is_symlink():
            raise ValueError('exclusive path already exists: ' + str(p))
    elif not p.exists():
        raise ValueError('input missing: ' + str(p))
    return p


def save(path, value):
    with Path(path).open('x') as f:
        json.dump(value, f, indent=2)
        f.write('\n')


def inventory(root, skip=()):
    root = plain(root)
    result = {}
    def walk(directory):
        for p in sorted(directory.iterdir()):
            rel = p.relative_to(root).as_posix()
            if rel in skip:
                continue
            if p.is_symlink():
                raise ValueError('symlink in inventory: ' + str(p))
            if p.is_dir():
                walk(p)
            elif p.is_file():
                result[rel] = sha(p)
            else:
                raise ValueError('nonregular inventory entry')
    walk(root)
    return result


def copy_file(source, target, expected=None):
    source = plain(source)
    if not source.is_file() or source.stat().st_nlink != 1:
        raise ValueError('regular singly linked source required: ' + str(source))
    data = source.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if expected is not None and digest != expected.removeprefix('sha256:'):
        raise ValueError('source fingerprint changed: ' + str(source))
    plain(target, True)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('xb') as f:
        f.write(data)
    target.chmod(source.stat().st_mode & 0o777)
    if sha(source) != digest:
        raise ValueError('source changed during capture')
    return digest


def require_historical_checkout():
    message = ('historical release source tree is retired or incomplete; replay the fixed '
               'historical checkout 675a9366cf270995ef714e505e42c19652f0e4f0 or clean1134 '
               'archive, not the current author toolchain; v1 will not be recreated')
    # Do not let rglob(missing_root) silently produce an empty protected capture.
    for part in ['tools', 'simulator', 'v1/tree', 'v1/handwritten', 'v1/test', 'v1/formal-inputs', 'v1/integration', 'v1/third-party']:
        root = BANK / part
        if not root.is_dir() or root.is_symlink() or root.resolve() != root:
            raise ValueError(message)
        files = list(root.rglob('*'))
        if any(p.is_symlink() for p in files) or not any(p.is_file() and not set(p.relative_to(root).parts) & EXCLUDED for p in files):
            raise ValueError(message)
    for part in ['package.json', 'v1/tree/workshop.yaml', 'v1/integration/CONTRACT.md', 'v1/integration/ACCEPTANCE-MATRIX.md', 'v1/integration/HANDWRITTEN-SOURCE-MAP.json']:
        file = BANK / part
        if not file.is_file() or file.is_symlink() or file.resolve() != file or file.stat().st_size == 0:
            raise ValueError(message)


def capture(config):
    require_historical_checkout()
    required = {'schemaVersion', 'bundle', 'workId', 'javaHome', 'python', 'sources'}
    if set(config) - (required | {'runtime'}) or not required <= set(config):
        raise ValueError('unexpected release configuration fields')
    if config['schemaVersion'] != 'bank-v1-execution/v2':
        raise ValueError('execution schema v2 required')
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,50}', config['workId']):
        raise ValueError('invalid work ID')
    dest = plain(config['bundle'], True)
    if not dest.is_relative_to(BANK / '.scratch'):
        raise ValueError('candidate must be under bank scratch')
    sources = config['sources']
    if set(sources) != {'jsCapture', 'bcCapture', 'bcRuntime', 'support', 'options', 'license', 'admissionFixture'}:
        raise ValueError('explicit source captures required')
    if not (BANK / 'v1/tree/workshop.yaml').is_file():
        raise ValueError('historical release source tree is retired; replay the fixed historical checkout or clean1134 archive, not the current author toolchain')
    dest.mkdir()
    origins = {}
    put_readme = '''# Bank wealth V1 release candidate\n\nThis package contains the source inputs, two independent generators, frozen runtime artifacts, external Scala sources, tests and license evidence. It is not accepted until RELEASE-ACCEPTANCE.json records all original requirements and installed-location verification.\n\nSupported execution: macOS x86_64, JDK11 and Python3.10+. Integration additionally requires Docker with the pinned local MySQL8.4.11 and Mongo4.4 images, and local Playwright/Chromium. Mongo4.4 is EOL; this is a bounded local demo, not a production deployment recommendation.\n\nThe captured Node is node/bin/node. Main entry: bank/tools/v1-release.mjs. Existing acceptance evidence and credentials are never reused. Replay uses a fresh execution configuration outside this directory and a fresh candidate directory; run --check --execution CONFIG before --run --execution CONFIG. The v1 legacy --manifest path remains read-only.\n\nSources live under inputs, bank/v1/tree and bank/v1/formal-inputs. Handwritten code is mounted from supply/ext/scala, not copied into generated app source. Generated applications live under bank/target; caches, test journals and private integration data live under bank/.scratch and are not part of the immutable distribution inventory. Never ship private runtime directories.\n\nLicense texts and provenance are in supply/licenses and licenses. The sbt-twirl1.5.1 plugin is Apache-2.0. Preserve all applicable upstream license and attribution notices.\n'''
    with (dest/'README.md').open('x') as f: f.write(put_readme)
    def put(src, rel, expected=None):
        value = copy_file(src, dest / rel, expected)
        origins[rel] = {'source': str(src), 'sha256': value}
    for key, prefix, selected in [('jsCapture', 'js-generator', 'generator/'), ('bcCapture', 'bc-generator', 'generator/')]:
        receipt_path = plain(sources[key])
        receipt = json.loads(receipt_path.read_text())
        root = plain(receipt['root'])
        for rel, row in receipt['files'].items():
            digest = row if isinstance(row, str) else row['sha256']
            if rel.startswith(selected):
                put(root / rel, prefix + '/' + rel[len(selected):], digest)
            elif key == 'bcCapture' and rel.startswith(('maven/', 'launcher/')):
                put(root / rel, 'bc-build-supply/' + rel, digest)
        put(receipt_path, 'evidence/' + key + '.json')
    js = json.loads(Path(sources['jsCapture']).read_text())
    jsroot = Path(js['root'])
    original_js = Path(js['files']['generator/lib/products/cli.mjs']['source']).parents[2]
    for rel in ['test/service-application-fixture.mjs', 'test/service-artifact-fixture.mjs']:
        put(original_js/rel, 'js-generator/' + rel)
    for name in ['inventory-mixed-effect-products', 'domain-generation']:
        folder = original_js/'test/fixtures'/name
        for p in sorted(folder.rglob('*')):
            if p.is_file(): put(p, 'js-generator/' + p.relative_to(original_js).as_posix())
    for rel, row in js['files'].items():
        digest = row if isinstance(row, str) else row['sha256']
        if rel.startswith(('inputs/', 'node/', 'supply/')) and not rel.startswith('supply/boot/'):
            put(jsroot / rel, rel, digest)
    fixture = plain(sources['admissionFixture'])
    for name in ['request.json', 'compiled.json']:
        put(fixture/name, 'admission/' + name)
    cp = json.loads(plain(sources['bcRuntime']).read_text())['bcClasspath']
    runtime = []
    for i, value in enumerate(cp):
        name = 'bc-runtime/' + str(i) + '-' + Path(value).name
        put(Path(value), name)
        runtime.append(name)
    support = plain(sources['support'])
    sm = json.loads((support / 'TEST-SUPPORT.json').read_text())
    for rel, digest in sm['files'].items():
        original = sm['provenance'].get(rel)
        if original and sha(original['source']) != original['sha256']:
            raise ValueError('test support source is stale: ' + rel)
        put(support / rel, 'support/' + rel, digest)
    put(support / 'TEST-SUPPORT.json', 'evidence/test-support.json')
    for part in ['tools', 'simulator', 'v1/tree', 'v1/handwritten', 'v1/test', 'v1/formal-inputs', 'v1/third-party']:
        root = BANK / part
        for p in sorted(root.rglob('*')):
            if p.is_file() and not set(p.relative_to(root).parts) & EXCLUDED:
                put(p, 'bank/' + p.relative_to(BANK).as_posix())
    for rel in ['package.json', 'v1/integration/CONTRACT.md', 'v1/integration/ACCEPTANCE-MATRIX.md', 'v1/integration/HANDWRITTEN-SOURCE-MAP.json']:
        put(BANK / rel, 'bank/' + rel)
    for rel, digest in sm['files'].items():
        if rel.startswith('bank/') and not (dest / rel).exists():
            put(support / rel, rel, digest)
    opts = json.loads(plain(sources['options']).read_text())
    opts['runtimeArtifact']['repository'] = '${BUNDLE}/supply/maven/'
    opts['service']['externalSourceRoots'] = ['${BUNDLE}/supply/ext/scala']
    save(dest / 'options-template.json', opts)
    license_root = plain(sources['license'])
    proof = json.loads((license_root / 'EVIDENCE.json').read_text())
    if proof.get('pluginSpecificEvidenceSatisfied') is not True or proof.get('license') != 'Apache-2.0':
        raise ValueError('Twirl plugin license evidence required')
    for row in proof['requests']:
        if sha(license_root / row['file']) != row['sha256']:
            raise ValueError('license source drift')
    for p in sorted(license_root.iterdir()):
        put(p, 'licenses/sbt-twirl-1.5.1/' + p.name)
    if inventory(dest/'supply/ext/scala') != inventory(dest/'bank/v1/handwritten/scala'):
        raise ValueError('packaged external source differs from authored bank source')
    if inventory(dest/'support/tests/scala') != inventory(dest/'bank/v1/test/scala'):
        raise ValueError('test support differs from complete authored Scala tests')
    for rel, row in origins.items():
        if sha(row['source']) != row['sha256']:
            raise ValueError('source changed during bundle capture: ' + rel)
    record = {'schemaVersion': 'bank-v1-bundle/v2', 'files': inventory(dest), 'origins': origins,
              'bcClasspath': runtime, 'platform': 'darwin-x86_64', 'externalPrerequisites': ['JDK 11', 'Python 3.10+', 'macOS sandbox-exec', 'Docker and specified local images for integration', 'Playwright and Chromium for browser validation'],
              'generatedApplications': 'Created by replay in fresh bank/target; source bundle itself is immutable.', 'accepted': False}
    save(dest / 'BUNDLE.json', record)
    return record


def verify_bundle(bundle):
    bundle = plain(bundle)
    manifest = json.loads((bundle / 'BUNDLE.json').read_text())
    for rel, digest in manifest['files'].items():
        p = plain(bundle / rel)
        if sha(p) != digest:
            raise ValueError('bundle file drift: ' + rel)
    actual = inventory(bundle, ['BUNDLE.json','PROMOTION.json','RELEASE-ACCEPTANCE.json','bank/target','bank/.scratch'])
    if actual != manifest['files']:
        raise ValueError('bundle contains missing or unlisted source files')
    return manifest


def execute(argv, cwd, env, root, seconds, sandbox=None):
    root.mkdir()
    command = ([ '/usr/bin/sandbox-exec', '-f', str(sandbox)] if sandbox else []) + list(map(str, argv))
    started = time.monotonic()
    with (root / 'stdout.log').open('xb') as out, (root / 'stderr.log').open('xb') as err:
        p = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=out, stderr=err, start_new_session=True)
        timed = False
        cancelled = None
        cancel_at = None
        def stop(sig, frame):
            nonlocal cancelled, cancel_at
            cancelled = signal.Signals(sig).name
            cancel_at = time.monotonic()
            try: os.killpg(p.pid, signal.SIGTERM)
            except ProcessLookupError: pass
        handlers = {s: signal.signal(s, stop) for s in [signal.SIGINT, signal.SIGTERM]}
        try:
            while p.poll() is None:
                now = time.monotonic()
                if now - started >= seconds and not timed:
                    timed = True; cancel_at = now
                    try: os.killpg(p.pid, signal.SIGTERM)
                    except ProcessLookupError: pass
                if cancel_at is not None and now - cancel_at >= 10:
                    try: os.killpg(p.pid, signal.SIGKILL)
                    except ProcessLookupError: pass
                try: p.wait(timeout=0.2)
                except subprocess.TimeoutExpired: pass
            code = p.wait()
        finally:
            for s, handler in handlers.items():
                signal.signal(s, handler)
    lingering = False
    try:
        os.killpg(p.pid, 0)
        lingering = True
        os.killpg(p.pid, signal.SIGTERM)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try: os.killpg(p.pid, 0)
            except ProcessLookupError: break
            time.sleep(.1)
        else:
            try: os.killpg(p.pid, signal.SIGKILL)
            except ProcessLookupError: pass
    except ProcessLookupError:
        pass
    result = {'argv': command, 'cwd': str(cwd), 'pid': p.pid, 'exitCode': code, 'waited': True, 'timedOut': timed, 'cancelled': cancelled,
              'lingeringProcessGroup': lingering, 'elapsedSeconds': time.monotonic()-started,
              'logs': {n: {'file': str(root/n), 'sha256': sha(root/n)} for n in ['stdout.log', 'stderr.log']}}
    save(root / 'result.json', result)
    if code != 0 or timed or cancelled or lingering:
        raise RuntimeError('execution failed; preserved logs at ' + str(root))
    return result


def sandbox_profile(path, reads, writes, executables, execroots=()):
    ancestors = set()
    for p in reads:
        ancestors.update(Path(p).parents)
    q = lambda p: json.dumps(str(p))
    text = '(version 1)\n(allow default)\n(deny network*)\n(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/private/tmp"))\n'
    text += '(allow file-read* ' + ' '.join('(subpath '+q(p)+')' for p in reads) + ' ' + ' '.join('(literal '+q(p)+')' for p in sorted(ancestors)) + ')\n'
    text += '(deny file-write*)\n(allow file-write* ' + ' '.join('(subpath '+q(p)+')' for p in writes) + ')\n'
    text += '(deny process-exec)\n(allow process-exec ' + ' '.join('(literal '+q(p)+')' for p in executables) + ' ' + ' '.join('(subpath '+q(p)+')' for p in execroots) + ')\n'
    with path.open('x') as f:
        f.write(text)


def context(config):
    bundle = plain(config['bundle'])
    manifest = verify_bundle(bundle)
    bank = bundle / 'bank'
    work = bank / '.scratch/p26-p32-bank-v1-59o__arv'
    jdk = plain(config['javaHome'])
    node = bundle / 'node/bin/node'
    return bundle, manifest, bank, work, jdk, node


def generate(config, chain):
    bundle, manifest, bank, work, jdk, node = context(config)
    target = bank / 'target/bank-wealth-release-v1' / config['workId'] / 'final' / (chain+'-app')
    root = work / 'generation' / chain
    plain(root, True); root.mkdir(parents=True)
    plain(target, True); target.parent.mkdir(parents=True, exist_ok=True)
    options = json.loads((bundle / 'options-template.json').read_text())
    options['runtimeArtifact']['repository'] = (bundle / 'supply/maven').as_uri() + '/'
    options['service']['externalSourceRoots'] = [str(bundle / 'supply/ext/scala')]
    save(root / 'options.json', options)
    (root/'home').mkdir(); (root/'tmp').mkdir()
    env = {'HOME': str(root/'home'), 'JAVA_HOME': str(jdk), 'PATH': str(jdk/'bin')+':/usr/bin:/bin', 'LANG': 'en_US.UTF-8', 'TMPDIR': str(root/'tmp'), 'TRUTHSRC_ROOT': str(bundle/'js-generator'), 'GIT_CEILING_DIRECTORIES': str(bundle)}
    repeat = target.parent.parent / 'repeat' / (chain+'-app')
    repeat.parent.mkdir(exist_ok=True)
    for i, output in enumerate([target, repeat]):
        prof = root / ('isolation-'+str(i)+'.sb')
        if chain == 'js':
            argv = [node, bank/'tools/v1-release-stage.mjs', 'generate', bundle, output, root/'options.json']
            executables = [node, Path('/usr/bin/git'), Path('/Library/Developer/CommandLineTools/usr/bin/git')]
        else:
            argv = [jdk/'bin/java', '-Xmx2G', '-Duser.home='+str(root/'home'), '-Djava.io.tmpdir='+str(root/'tmp'), '-Dcodegen.semanticProductsFile='+str(bundle/'inputs/compiled.json'), '-Dcodegen.productOptionsFile='+str(root/'options.json'), '-Dcodegen.productTargetProfile=scala-cqrs-play-service@1', '-Dcodegen.targetDir='+str(output), '-Dcodegen.noGit=true', '-Dcodegen.generatorVersion=c612626f', '-cp', ':'.join(str(bundle/p) for p in manifest['bcClasspath']), 'net.imadz.codegen.CodegenMain']
            executables = [jdk/'bin/java', jdk/'lib/jspawnhelper']
        sandbox_profile(prof, [bundle, root], [root, output], executables)
        execute(argv, root, env, root/('run-'+str(i)), 150, prof)
    execute([node, bank/'tools/v1-release-stage.mjs', 'provenance', bundle, target, repeat, root/'RESULT.json'], root, env, root/'verify', 90)
    return target


def build(config, chain):
    bundle, manifest, bank, work, jdk, node = context(config)
    target = bank / 'target/bank-wealth-release-v1' / config['workId'] / 'final' / (chain+'-app')
    root = work / 'builds' / chain
    plain(root, True); root.mkdir(parents=True)
    sources = inventory(target)
    if any(p.startswith(('target/', 'project/target/', 'project/project/target/')) for p in sources):
        raise ValueError('cold target already built')
    support = root/'support'; support.mkdir()
    for rel, digest in inventory(bundle/'support').items():
        copy_file(bundle/'support'/rel, support/rel, digest)
    for name in ['home','boot','global','ivy','coursier','tmp','guard']:
        (root/name).mkdir()
    env = {'HOME': str(root/'home'), 'JAVA_HOME': str(jdk), 'PATH': str(jdk/'bin')+':/usr/bin:/bin', 'LANG': 'en_US.UTF-8', 'TMPDIR': str(root/'tmp'), 'TRUTHSRC_ROOT': str(bundle/'js-generator'), 'GIT_CEILING_DIRECTORIES': str(bundle), 'COURSIER_CACHE': str(root/'coursier'), 'COURSIER_REPOSITORIES': (bundle/'supply/maven').as_uri()+'/'}
    execute([node, bank/'tools/v1-release-stage.mjs', 'build-config', bundle, support, root], root, env, root/'configure', 45)
    cfg = json.loads((root/'BUILD-CONFIG.json').read_text())
    (root/'guard/BankColdNetworkGuard.java').write_text('import java.security.Permission; public final class BankColdNetworkGuard extends SecurityManager { public void checkPermission(Permission p) {} public void checkPermission(Permission p,Object c) {} public void checkConnect(String h,int p) {throw new SecurityException("offline build");} public void checkConnect(String h,int p,Object c) {checkConnect(h,p);} public void checkListen(int p) {throw new SecurityException("offline build");} public void checkAccept(String h,int p) {checkConnect(h,p);} }')
    journals = [support/'bank/.scratch/p24-p25-bank-joint-fkcd3jwe', support/'bank/.scratch/p26-p32-bank-v1-59o__arv/ta-application-tests']
    for p in journals: p.mkdir(parents=True)
    protoc = root/'home/Library/Caches/com.thesamet.scalapb.protocbridge.protocbridge/v1/protoc-osx-x86_64-3.19.2'
    executables = [jdk/'bin/java', jdk/'bin/javac', jdk/'lib/jspawnhelper', support/'bin/node', protoc, Path('/usr/bin/mkfifo'), Path('/bin/sh'), Path('/bin/bash'), Path('/bin/cat')]
    profile = root/'isolation.sb'
    sandbox_profile(profile, [bundle/'supply/maven', bundle/'supply/ivy', bundle/'supply/ext', bundle/'supply/launcher', target, root], [root,target], executables, [root/'tmp'])
    execute([jdk/'bin/javac','-d',root/'guard',root/'guard/BankColdNetworkGuard.java'],root,env,root/'javac',45,profile)
    props = {'user.home':'home','sbt.boot.directory':'boot','sbt.global.base':'global','sbt.ivy.home':'ivy','coursier.cache':'coursier','java.io.tmpdir':'tmp','sbt.repository.config':'repositories','sbt.boot.properties':'sbt.boot.properties'}
    tasks = cfg['tasks'] + ['set Test / javaOptions ++= Seq('+json.dumps('-Duser.home='+str(root/'home'))+', '+json.dumps('-Djava.io.tmpdir='+str(root/'tmp'))+')','show externalResolvers','update','compile','Test / update','Test / compile','show Test / definedTests','show Test / fullClasspath','test']
    argv = [jdk/'bin/java','-Xmx2G','-Djava.security.manager=BankColdNetworkGuard','-Dsbt.server.autostart=false','-Dsbt.server.forcestart=true','-Dsbt.supershell=false','-Dsbt.log.noformat=true','-Dsbt.override.build.repos=true',*['-D'+k+'='+str(root/v) for k,v in props.items()],'-cp',str(root/'guard')+':'+str(bundle/'supply/launcher/sbt-launch.jar'),'xsbt.boot.Boot',*tasks]
    before = {'generated':sources, 'handwritten':inventory(bank/'v1/handwritten'), 'tests':inventory(bank/'v1/test')}
    save(root/'INPUT.json', {'sources':before,'argv':list(map(str,argv)),'cachesInitiallyEmpty':True,'bridgePrefilled':False,'sandboxSha256':sha(profile)})
    result = execute(argv,target,env,root/'sbt',480,profile)
    if inventory(target, ['target','project/target','project/project/target','.bsp','.bloop']) != sources:
        raise ValueError('generated source changed during build')
    text = (root/'sbt/stdout.log').read_text()
    counts = re.findall(r'Total number of tests run: (\d+)', text)
    if len(counts)!=1 or int(counts[0])==0 or 'All tests passed.' not in text or not re.search(r'Tests: succeeded \d+, failed 0, canceled 0, ignored 0, pending 0',text):
        raise ValueError('complete successful test summary required')
    export = target/'target/streams/test/fullClasspath/_global/streams/export'
    cp = export.read_text().strip().split(':')
    entries = {}
    for value in cp:
        p=plain(value) if Path(value).exists() else Path(value)
        if not (p.is_relative_to(target) or p.is_relative_to(bundle/'supply')): raise ValueError('external classpath fallback')
        if p.is_dir(): entries[str(p)]=inventory(p)
        elif p.is_file(): entries[str(p)]=sha(p)
        else:
            if p not in [target/'target/web/classes/main',target/'target/web/classes/test',target/'target/web/public/main']: raise ValueError('unexpected absent classpath')
            entries[str(p)]={'absent':True}
    if sha(protoc)!=sha(bundle/'supply/maven/com/google/protobuf/protoc/3.19.2/protoc-3.19.2-osx-x86_64.exe'): raise ValueError('protoc copy differs')
    suites = {}
    current_suite = None
    for line in text.splitlines():
        match = re.fullmatch(r'\[info\] ([A-Za-z0-9_]+Spec):', line)
        if match:
            current_suite = match.group(1); suites[current_suite] = []
        elif line.startswith('[info] - ') and current_suite:
            suites[current_suite].append(line[len('[info] - '):])
    if sum(map(len, suites.values())) != int(counts[0]):
        raise ValueError('per-suite test markers differ from total')
    record = {'schemaVersion':'bank-release-build/v2','chain':chain,'target':str(target),'classpath':cp,'classpathInventory':entries,'source':before,'execution':result,'tests':{'count':int(counts[0]),'suites':suites},'cachesInitiallyEmpty':True,'bridgePrefilled':False,'sourceUnchanged':True}
    save(root/'BUILD.json',record)
    return record


def admission(config):
    bundle, manifest, bank, work, jdk, node = context(config)
    root = work/'admission'; root.mkdir()
    env={'HOME':str(root),'JAVA_HOME':str(jdk),'PATH':str(jdk/'bin')+':/usr/bin:/bin','LANG':'en_US.UTF-8','TRUTHSRC_ROOT':str(bundle/'js-generator'),'GIT_CEILING_DIRECTORIES':str(bundle)}
    execute([node,bank/'tools/v1-release-stage.mjs','admission',bundle,root],root,env,root/'js',100)
    java_source = root/'TypedAdmission.java'
    java_source.write_text('import net.imadz.meta.products.SemanticProductAdapter; public class TypedAdmission { public static void main(String[] args) { if (!SemanticProductAdapter.fromFile(args[0]).isRight()) throw new IllegalArgumentException("typed nonfinancial fixture rejected"); System.out.println("typed-nonfinancial-accepted"); } }')
    cp=':'.join(str(bundle/p) for p in manifest['bcClasspath'])
    execute([jdk/'bin/javac','-cp',cp,'-d',root,java_source],root,env,root/'javac',45)
    execute([jdk/'bin/java','-cp',str(root)+':'+cp,'TypedAdmission',bundle/'admission/compiled.json'],root,env,root/'typed',60)
    nonfinancial = root/'nonfinancial-bc'
    argv=[jdk/'bin/java','-Dcodegen.semanticProductsFile='+str(root/'nonfinancial-compiled.json'),'-Dcodegen.productOptionsFile='+str(root/'nonfinancial-options.json'),'-Dcodegen.productTargetProfile=scala-cqrs-play-service@1','-Dcodegen.targetDir='+str(nonfinancial),'-Dcodegen.noGit=true','-Dcodegen.generatorVersion=c612626f','-cp',cp,'net.imadz.codegen.CodegenMain']
    execute(argv,root,env,root/'nonfinancial-bc-execute',90)
    rejected=[]
    for i in range(2):
        target=root/('rejected-bc-'+str(i))
        argv=[jdk/'bin/java','-Dcodegen.semanticProductsFile='+str(bundle/'inputs/compiled.json'),'-Dcodegen.productOptionsFile='+str(root/('invalid-options-'+str(i)+'.json')),'-Dcodegen.productTargetProfile=scala-cqrs-play-service@1','-Dcodegen.targetDir='+str(target),'-Dcodegen.noGit=true','-Dcodegen.generatorVersion=c612626f','-cp',cp,'net.imadz.codegen.CodegenMain']
        try: execute(argv,root,env,root/('bc-'+str(i)),60)
        except RuntimeError: pass
        result=json.loads((root/('bc-'+str(i))/'result.json').read_text())
        if result['exitCode']!=1 or result['timedOut'] or target.exists(): raise ValueError('BC rejection must precede target creation')
        err=(root/('bc-'+str(i))/'stderr.log').read_text()
        if 'Generation Failed' not in err: raise ValueError('not a generator admission rejection')
        rejected.append({'target':str(target),'targetAbsent':True,'execution':result})
    save(root/'RESULT.json',{'schemaVersion':'bank-release-admission/v2','js':json.loads((root/'JS.json').read_text()),'bc':{'nonfinancialTypedProductAccepted':True,'nonfinancialPublicGeneration':str(nonfinancial),'rejected':rejected},'nonfinancialOutputs':{chain:inventory(root/('nonfinancial-'+chain)) for chain in ['js','bc']},'fixtureSha256':sha(bundle/'admission/compiled.json'),'passed':True})


def acceptance(config, chain, kind):
    bundle, manifest, bank, work, jdk, node = context(config)
    target = bank / 'target/bank-wealth-release-v1' / config['workId'] / 'final' / (chain+'-app')
    receipt = work / 'builds' / chain / 'BUILD.json'
    env = {'HOME': str(work), 'JAVA_HOME': str(jdk), 'PATH': str(jdk/'bin')+':/usr/bin:/bin', 'LANG':'en_US.UTF-8', 'TRUTHSRC_ROOT':str(bundle/'js-generator'), 'GIT_CEILING_DIRECTORIES':str(bundle)}
    if kind == 'http':
        execute([node,bank/'tools/v1-release-stage.mjs','http',bundle,target,receipt,work/('http-'+chain),jdk/'bin/java'],bank,env,work/('invoke-http-'+chain),360)
    elif kind == 'runtime':
        import importlib.util
        spec = importlib.util.spec_from_file_location('release_runtime', Path(__file__).with_name('v1-release-runtime.py'))
        runtime = importlib.util.module_from_spec(spec);spec.loader.exec_module(runtime)
        runtime.run_runtime(config,work/'runtime'/chain,chain)
    else:
        owned=work/('crash-'+chain+'-'+kind)
        namespace='crash_'+config['workId']+'_'+chain+'_'+hashlib.sha256(kind.encode()).hexdigest()[:8]
        execute([node,bank/'tools/v1-release-stage.mjs','recovery',bundle,target,receipt,owned,jdk/'bin/java',node,kind,namespace],bank,env,work/('invoke-crash-'+chain+'-'+kind),420)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--config',required=True)
    parser.add_argument('--stage', required=True)
    args=parser.parse_args()
    config=json.loads(plain(args.config).read_text())
    config_file = plain(args.config)
    lockroot = next((p for p in config_file.parents if p.name == '.scratch'), None)
    if lockroot is None:
        raise ValueError('execution configuration must belong to an owned scratch root')
    with (lockroot/'repair-execution.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if args.stage=='capture': capture(config)
        elif args.stage=='admission': admission(config)
        elif args.stage.startswith('generate-'): generate(config,args.stage[-2:])
        elif args.stage.startswith('build-'): build(config,args.stage[-2:])
        elif args.stage in ['http-js','http-bc','runtime-js','runtime-bc']: acceptance(config,args.stage[-2:],args.stage.split('-')[0])
        elif args.stage.startswith(('recovery-js-', 'recovery-bc-')):
            acceptance(config,args.stage.split('-')[1],args.stage.split('-',2)[2])
        elif args.stage == 'promote':
            bundle,manifest,bank,work,jdk,node=context(config)
            out=work/'promotion';out.mkdir()
            destination=plain(lockroot.parent/'dist/v1',True)
            env={'HOME':str(work),'PATH':'/usr/bin:/bin','LANG':'en_US.UTF-8','TRUTHSRC_ROOT':str(bundle/'js-generator'),'GIT_CEILING_DIRECTORIES':str(bundle)}
            execute([node,bank/'tools/v1-release-stage.mjs','promote',bundle,work,destination],bank,env,out/'execute',180)
            save(out/'RESULT.json',{'destination':str(destination),'promotionSha256':sha(destination/'PROMOTION.json')})
        elif args.stage in ['final-provenance','certify']:
            bundle,manifest,bank,work,jdk,node=context(config)
            out=work/('provenance' if args.stage=='final-provenance' else 'certification');out.mkdir()
            env={'HOME':str(work),'PATH':'/usr/bin:/bin','LANG':'en_US.UTF-8','TRUTHSRC_ROOT':str(bundle/'js-generator'),'GIT_CEILING_DIRECTORIES':str(bundle)}
            execute([node,bank/'tools/v1-release-stage.mjs',args.stage,bundle,work,out/'RESULT.json'],bank,env,out/'execute',180)
        else: raise ValueError('unknown fixed execution stage')
    print(json.dumps({'stage':args.stage,'status':'passed','releaseAccepted':False}))


if __name__=='__main__':
    main()
