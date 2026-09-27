import functools, http.server
DIR = r"C:\Projetos pessoais\Teste-NoSQL"
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIR)
http.server.ThreadingHTTPServer(("127.0.0.1", 5500), Handler).serve_forever()
