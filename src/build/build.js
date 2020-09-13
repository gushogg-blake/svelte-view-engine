let yargs = require("yargs");
let fs = require("flowfs");
let readStream = require("../utils/readStream");
let buildSsr = require("./buildSsrComponent");
let buildDom = require("./buildDomComponent");

(async function() {
	try {
		let {
			name,
			path,
			buildPath,
			config,
			useCache,
		} = JSON.parse(await readStream(process.stdin));
		
		let buildFile = fs(buildPath);
		let cache = {};
		
		if (useCache && await buildFile.exists()) {
			let {client, server} = await buildFile.readJson();
			
			cache.client = client.cache;
			cache.server = server.cache;
		}
		
		let server = await buildSsr(path, config, cache.server);
		let client = await buildDom(path, name, config, cache.client);
		
		await buildFile.parent.mkdirp();
		
		await buildFile.writeJson({
			server,
			client,
		});
	} catch (e) {
		console.error(e);
		
		process.exit(1);
	}
})();