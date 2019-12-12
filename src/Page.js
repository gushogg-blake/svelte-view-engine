let chokidar = require("chokidar");
let fs = require("flowfs");
let cmd = require("./utils/cmd");
let validIdentifier = require("./utils/validIdentifier");
let instantiateSsrModule = require("./utils/instantiateSsrModule");
let payload = require("./payload");

/*
the render() method returns a string containing the complete HTML for the page,
which can be passed directly back to express.

Template placeholders used:

${head} - svelte:head markup from SSR
${html} - component markup from SSR
${css} - component CSS
${js} - component JS as "var ${name} = function..."
${name} - the component name used in the var declaration above
${props} - a JSON-stringified object of props to render
*/

/*
saving a .scss file that gets @imported into the .svelte <style>
triggers a rebuild, but for some reason doesn't use the new css
if using cached bundles
*/

let noCacheDependencyTypes = ["sass", "scss"];

module.exports = class {
	constructor(template, path, options, liveReloadSocket) {
		this.template = template;
		this.path = path;
		this.options = options;
		this.liveReloadSocket = liveReloadSocket;
		this.name = validIdentifier(fs(path).basename);
		
		this.ready = false;
		this.pendingBuild = null;
		this.buildFile = fs(path).reparent(options.dir, options.buildDir).withExt(".json");
	}
	
	async runBuildScript(noCache=false) {
		let json = {
			name: this.name,
			path: this.path,
			buildPath: this.buildFile.path,
			noCache,
			options: this.options,
		};
		
		await cmd(`
			js
			${this.options.buildScript}
			'${JSON.stringify(json)}'
		`);
	}
	
	async _build(rebuild, noCache) {
		try {
			if (rebuild || !await this.buildFile.exists()) {
				await this.runBuildScript(noCache);
			}
			
			let {
				client,
				server,
			} = await this.buildFile.readJson();
	
			this.serverComponent = server;
			this.clientComponent = client;
	
			this.ssrModule = await instantiateSsrModule(this.serverComponent.component, this.path);
			
			if (this.options.watch) {
				if (this.watcher) {
					this.watcher.close();
				}
				
				this.watcher = chokidar.watch(this.clientComponent.watchFiles);
				
				this.watcher.on("change", (path) => {
					let noCache = noCacheDependencyTypes.includes(fs(path).type);
					
					this.ready = false;
					this.build(true, noCache);
				});
			}
			
			if (this.options.liveReload) {
				for (let client of this.liveReloadSocket.clients) {
					client.send(this.path);
				}
			}
			
			this.ready = true;
		} catch (e) {
			this.buildFile.delete();
			
			throw e;
		}
	}
	
	async build(rebuild, noCache) {
		if (noCache && this.pendingBuild) {
			await this.pendingBuild;
			
			this.pendingBuild = null;
		}
		
		if (!this.pendingBuild) {
			this.pendingBuild = this._build(rebuild, noCache);
		}
		
		await this.pendingBuild;
	
		this.pendingBuild = null;
	}
	
	async render(locals) {
		if (!this.ready) {
			await this.build();
		}
		
		/*
		set the payload; render; then unset
		
		the payload is global -- this is required to get access to the current
		value from within the compiled serverside component, and also to make the
		same module (./payload) work for both server- and client-side code.
		*/
		
		payload.set(locals);
		
		/*
		note that we don't use .css from render() - this only includes CSS for
		child components that happen to be rendered this time.  we use
		serverComponent.css which has CSS for all components that are imported
		(ie all components that could possibly be rendered)
		*/
		
		let head;
		let html;
		let css;
		
		try {
			({head, html} = this.ssrModule.render(locals));
			({css} = this.serverComponent);
		} finally {
			payload.set(null);
		}
		
		let {js} = this.clientComponent;
		
		let str = "";
		let props = JSON.stringify(locals);
		
		await this.template.render({
			raw: (content) => {
				str += content;
			},
			
			head: () => {
				str += head;
				
				if (this.options.liveReload) {
					str += `
						<script>
							function createSocket() {
								var socket = new WebSocket("ws://" + location.hostname + ":${this.options.liveReloadPort}");
								
								socket.addEventListener("message", function(message) {
									if (message.data === "${this.path}") {
										location.reload();
									}
								});
								
								socket.addEventListener("close", function() {
									setTimeout(createSocket, 500);
								});
							}
							
							createSocket();
						</script>
					`;
				}
			},
			
			html: () => {
				str += html;
			},
			
			css: () => {
				str += css.code;
			},
			
			js: () => {
				str += js.code;
			},
			
			name: () => {
				str += this.name;
			},
			
			props: () => {
				str += props;
			},
		});
		
		return str;
	}
}
