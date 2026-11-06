# Limitações conhecidas

- **VFR**: detecção por heurística (r_frame_rate × avg_frame_rate, 1%). MKV raramente informa número de quadros; casos de VFR sutil podem passar sem aviso.
- **Miniaturas rápidas**: com `-skip_frame nokey`, cada miniatura é o keyframe mais próximo, não o instante exato. Suficiente para a régua da timeline.
- **Hash parcial**: dois arquivos com mesmo tamanho, início e fim idênticos teriam o mesmo hash. Improvável em mídia real.
