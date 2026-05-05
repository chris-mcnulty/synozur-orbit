import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installTabContextFetchInterceptor } from "./lib/tabContext";

installTabContextFetchInterceptor();

createRoot(document.getElementById("root")!).render(<App />);
