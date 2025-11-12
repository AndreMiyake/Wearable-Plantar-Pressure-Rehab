# 🩺 Wearable Plantar Pressure Rehab

**Web system for monitoring and analyzing plantar pressure in patients undergoing physiotherapeutic rehabilitation.**

---

## 🧠 Overview

This project integrates a **wearable device** equipped with **FSR-402 pressure sensors** and an **Arduino microcontroller** with a **FastAPI backend** and a **React + Vite frontend**.

It provides real-time visualization of **plantar pressure distribution** on an anatomical foot silhouette and computes metrics such as **maximum pressure** and **regional load distribution**.

The system supports physiotherapists in tracking the **rehabilitation progress of post-stroke patients**, enabling the recording of sessions, comparison of results, and interactive visualization of evolution over time.

---

## ⚙️ Tech Stack

**Hardware:**
- Arduino + FSR-402 pressure sensors

**Backend:**
- FastAPI (Python)
- Serial communication with Arduino

**Frontend:**
- React + TypeScript
- Vite (build tool)

---

## 🚀 How to Run

### 1. Backend

cd backend
pip install -r requirements.txt
set DATABASE_URL=postgresql://postgres:1809@localhost:5432/gaitvision (PowerShell: `$env:DATABASE_URL = "postgresql://postgres:1809@localhost:5432/gaitvision"`)
alembic upgrade head
set ARDUINO_PORT=<porta_do_arduino> (PowerShell: `$env:ARDUINO_PORT = "COM5"`)
# Para usar o ESP32 pareado via Bluetooth SPP (RFCOMM) direto no backend:
set USE_BLUETOOTH=1
set ESP32_BT_ADDRESS=<MAC_do_esp32>   (ex.: `98:D3:31:F7:42:10`)
set ESP32_BT_CHANNEL=1                (ajuste conforme o firmware)
uvicorn main:app

### 2. Frontend

cd frontend
npm install
npm run dev

---

## 📊 Features

- Real-time plantar pressure monitoring

- Visualization over anatomical foot silhouette

- Metrics: max pressure, load distribution, session tracking

- Data acquisition via Arduino (serial communication)

- Designed for physiotherapy and post-stroke rehabilitation

- Session history per patient with automatic comparison between sessions

---

## 🗂️ Sessões de Pacientes

- Cadastre um paciente diretamente no painel superior do frontend.
- Inicie uma sessão para o paciente selecionado e deixe o sistema coletar automaticamente cada leitura de pressão.
- Encerre a sessão para consolidar os dados. O histórico lista todas as sessões com amostras, duração, notas e médias por região do pé.
- Compare a sessão atual com a anterior para observar tendências de melhora ou piora nas regiões (calcanhar, meio-pé, ponta).

### 🔐 Fluxo do Fisioterapeuta

1. Acesse `/login`, informe email/senha (mock local) e será redirecionado para `/home`.
2. No painel, cadastre ou selecione um paciente, escreva observações e clique em **Iniciar sessão**.
3. A página `/session/:id` exibe dados do paciente, cronologia da sessão e o mapa de calor em tempo real.
4. Clique em **Finalizar sessão** para encerrar o registro e voltar ao painel.

### API de Sessões

Endpoint | Método | Descrição
-------- | ------ | ---------
`/patients` | GET / POST | Lista ou cria pacientes (nome obrigatório).
`/patients/{patient_id}/sessions` | GET / POST | Lista sessões do paciente ou abre uma nova sessão (opcionalmente com nota).
`/sessions/{session_id}/data` | POST | Registra uma leitura de pressão para a sessão ativa (chamado automaticamente pelo frontend a cada amostra).
`/sessions/{session_id}/end` | POST | Encerra a sessão em andamento e marca horário de término.
`/sessions/{session_id}` | GET | Retorna detalhes completos de uma sessão, incluindo todas as amostras coletadas.

Os dados são persistidos no PostgreSQL (`sessions` e `pressure_samples`), permitindo comparar sessões ao longo do tempo mesmo após reiniciar o sistema.

> ⚠️ Se o backend exibir `Erro no loop serial: could not open port 'COMX'`, abra o Gerenciador de Dispositivos, identifique a porta correta do Arduino e exporte `ARDUINO_PORT` antes de iniciar o FastAPI.

### Authors

Developed by students of Biomedical Engineering from FICSAE
Project for the Semester 2025.2
