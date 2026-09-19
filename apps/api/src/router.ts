import { ApiRequest, ApiResponse } from './http-types.js';

export type RouteHandler = (req: ApiRequest, res: ApiResponse) => Promise<void> | void;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

export class Router {
  private routes: Route[] = [];

  public add(method: string, path: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    const regexPath = path.replace(/:([a-zA-Z0-9_]+)/g, (_, paramName) => {
      paramNames.push(paramName);
      return '([^/]+)';
    });

    this.routes.push({
      method: method.toUpperCase(),
      pattern: new RegExp(`^${regexPath}$`),
      paramNames,
      handler
    });
  }

  public get(path: string, handler: RouteHandler): void {
    this.add('GET', path, handler);
  }

  public post(path: string, handler: RouteHandler): void {
    this.add('POST', path, handler);
  }

  public put(path: string, handler: RouteHandler): void {
    this.add('PUT', path, handler);
  }

  public delete(path: string, handler: RouteHandler): void {
    this.add('DELETE', path, handler);
  }

  public match(method: string, pathname: string): { handler: RouteHandler; params: Record<string, string> } | null {
    const cleanMethod = method.toUpperCase();
    for (const route of this.routes) {
      if (route.method !== cleanMethod) continue;
      const match = route.pattern.exec(pathname);
      if (match) {
        const params: Record<string, string> = {};
        for (let i = 0; i < route.paramNames.length; i++) {
          const name = route.paramNames[i]!;
          params[name] = match[i + 1]!;
        }
        return { handler: route.handler, params };
      }
    }
    return null;
  }
}
