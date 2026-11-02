# task-stats

Un mod para Claude Code que muestra, arriba de la prompt box, tu usage y el progreso de la task que está corriendo, y abre un panel en vivo con cada subagente que se despliega.

## Qué muestra

**Franja arriba del prompt (siempre visible)**

- Barra de la ventana de 5h con el tiempo hasta el reset, % de contexto y costo de la sesión. La ventana de 7 días aparece solo cuando pasa del 70%.
- Durante una task: barra de progreso con tareas completadas / total cuando Claude armó una task list, o una barra animada cuando no la hay. Al lado: tiempo transcurrido, pasos, tokens y cuántos agentes hay corriendo (y cuántos en background).
- Al terminar (cuando terminó el último agente, incluidos los de background): un resumen `✓ 4m12s · 38k tokens · 3 agentes` hasta el próximo prompt.
- Colores: normal debajo del 70%, amarillo entre 70% y 90%, rojo desde 90%. Un aviso único cuando la ventana de 5h cruza el 90%.

**Panel de agentes**

- Se abre solo cuando arranca el primer subagente (en la terminal, si la ventana tiene al menos 144 columnas; si no, con `/task-stats`).
- Árbol de agentes: descripción, tipo, modelo, estado, barra propia, tiempo, pasos, tokens y la última herramienta usada.
- Los agentes terminados quedan en gris y se limpian al empezar una task nueva.

Los tokens cuentan input + output + escritura de caché; no suman las relecturas de caché de cada paso.

## Instalación

En la prompt de una sesión de Claude Code en la terminal:

```
/plugin install task-stats --marketplace Facuprz/task-stats
```

Respondé `y` para agregar el marketplace y elegí el scope (user es el primero).

Desde un shell:

```
claude plugin install task-stats --marketplace Facuprz/task-stats
```

En la app de escritorio, donde `/plugin` no corre: click en + al lado de la prompt box, Plugins, Add marketplace con `Facuprz/task-stats`, después Add plugin.

## Desarrollo

```
claude plugin validate .
claude plugin test .
```
