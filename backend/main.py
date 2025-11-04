from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from arduino_reader import read_pressure_data

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"message": "API da GaitVision ativa 🚀"}

@app.get("/pressao")
def get_pressao():
    try:
        data = read_pressure_data()
        return {"pressao": data}
    except Exception as e:
        return {"error": str(e)}