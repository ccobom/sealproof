// Keep the deployable test entry point default-only so Wrangler's generated
// main-module types do not misclassify exported test factories as handlers.
import productionWorker from "./production-app";

export default productionWorker;
