from setuptools import setup, find_packages

setup(
    name="ocr_extraction_demo",
    version="0.1.0",
    packages=find_packages(
        include=[
            "backend",
            "backend.*",
            "azure_model",
            "azure_model.*"
        ]
    ),
)
