# Operação Chumbo Grosso

Teste de criação de um jogo **run-and-gun 2D inspirado em Metal Slug**, feito com
HTML5 Canvas e JavaScript puro — sem dependências, sem build e sem assets externos
(todos os gráficos e sons são gerados por código).

## Como jogar

Abra `index.html` no navegador, ou sirva a pasta localmente:

```bash
python3 -m http.server 8000
# depois acesse http://localhost:8000
```

| Tecla | Ação |
| --- | --- |
| `←` `→` / `A` `D` | mover |
| `↑` / `W` | mirar para cima |
| `↓` / `S` | agachar (no ar: atirar para baixo) |
| `↓` + `X` | descer de uma plataforma |
| `Z` / `J` | atirar (faca quando o inimigo está colado) |
| `X` / `K` / `Espaço` | pular |
| `C` / `L` | granada |
| `P` / `Esc` | pausar |
| `Enter` | iniciar / recomeçar |

## O que já tem

- Fase com rolagem lateral só para a frente, parallax (montanhas e prédios em ruínas) e plataformas.
- Soldados inimigos (atiradores e granadeiros) e mini-chefes **tanque**, que travam a câmera até serem destruídos.
- Chefe final: **helicóptero** com dois padrões de ataque (fica mais agressivo abaixo de 50% de vida).
- Prisioneiros (POWs) para libertar, que entregam itens: **H** (Heavy Machine Gun), **B** (+10 bombas) e ★ (pontos).
- Granadas com quique, explosões com dano em área, tremor de tela, partículas e pontuação flutuante.
- Vidas, invencibilidade ao renascer, telas de título, pausa, game over e vitória.
- Efeitos sonoros sintetizados com WebAudio.

## Estrutura

```
index.html   página e canvas
style.css    layout
game.js      todo o jogo: entrada, áudio, física, IA, desenho e loop principal
```

## Ideias para próximos passos

- Sprites em pixel art e animações quadro a quadro.
- Veículo pilotável (o "Slug"), mais armas (Rocket, Flame Shot, Shotgun).
- Mais fases, checkpoints e controles por toque/gamepad.
