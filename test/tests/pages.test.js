let {deep} = require("../utils/assertions");
let config = require("../config");
let svelteViewEngine = require("../../index");

async function render(engine, page) {
	return await engine.render(engine.dir + "/" + page + "." + engine.type);
}

describe("svelte-view-engine", function() {
	describe("Pages", function() {
		it("renders page", async function() {
			let engine = svelteViewEngine(config());
			
			let res = JSON.parse(await render(engine, "A"));
			
			deep(res, {
				head: "head",
				css: "css",
				html: "html",
				props: "{}",
				js: "client component",
				name: "A",
			});
		});
	});
});