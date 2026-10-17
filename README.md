# OBSERVISTA VMG 03: Digital Tool for Ontology-Based Terminology

This repository contains the source code for the digital prototype developed under the **Virtual Mobility Grant (VMG 03)** for the **COST Action CA24134 OBSERVISTA**.

## 🌍 About OBSERVISTA
OBSERVISTA aims to innovate the approach to urban vacant spaces—commonly known as 'terrain vague'—by creating a pan-European knowledge hub for innovative repurposing strategies. In an era of rapid urbanisation and environmental challenges, these overlooked spaces present unique opportunities for addressing climate resilience, biodiversity loss, and social inequity. The Action bridges fragmented approaches across disciplines by:
1. Investigating diverse definitions, interpretations and forms of terrain vague across Europe.
2. Exploring innovative repurposing models.
3. Analysing legal and policy frameworks across different countries, scales and contexts.
4. Developing impactful activities, toolkits and frameworks.
5. Forging a Pan-European 'community of practice'.

## 🎯 Project Overview
As part of Working Group 1 (WG1), this project focuses on designing an accessible digital interface for the OBSERVISTA ontology-based terminology. Aimed at urbanists, planners, and non-ontology specialists, this tool abstracts the complexity of formal semantic languages.

It provides a user-friendly web application to seamlessly search, compare, and navigate "terrain vague" terminology. By integrating a map-based visualization component, the prototype contextualizes terminology spatially, linking abstract concepts directly to physical locations and WG2 case studies.

## ✨ Key Features
* **Semantic Search & Navigation:** Intuitive interface to query terminologies and explore relationships without requiring formal ontology expertise.
* **Geospatial Visualization:** Interactive mapping linking specific ontology terms to physical 'terrain vague' sites or WG2 case studies.
* **Modular Semantic Integration:** An agnostic backend layer designed to invoke semantic reasoners via command-line interfaces and serve parsed results via a RESTful API.

## 🛠️ Technology Stack
**Backend**
* **Rust & Axum:** High-performance, memory-safe server for efficient handling of concurrent requests.
* **Semantic Reasoner:** CLI wrapper executing queries (e.g., SPARQL) against standard OWL/RDF ontologies.

**Frontend**
* **TypeScript & Snabbdom:** Efficient, reactive virtual DOM architecture.
* **Bootstrap:** Responsive and accessible UI styling.
* **Leaflet:** Interactive map rendering for spatial contextualization.

## 🚀 Getting Started
*(Instructions for building and running the project locally, including Docker configurations or `cargo run` / `npm start` commands, will be documented here).*

## 🤝 Acknowledgements
This project is supported by the Virtual Mobility Grant from the **COST Action CA24134: OBSERVISTA** (Observatory of Innovative Strategies for Repurposing Terrain Vague). 

**Keywords:** Terrain Vague, Landscape Ecology, Applied Ontology, Community of Practice, Participatory Design.