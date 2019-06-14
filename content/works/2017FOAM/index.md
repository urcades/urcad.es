+++
title = "From-scratch Crypto-mapping UX"
description = "FOAM UX"
date = 2017-11-29
slug = "foam"
weight = 0
draft = false
aliases = []
in_search_index = true
template = "page.html"
[taxonomies]
+++

_Project Context_

I was contacted by FOAM’s CEO Ryan King to translate their _seed funding pitch deck_ (specifically screenshots of a proto-interface in the deck) into an initial product that would ease _non-blockchain-aware_ and _non-crypto-bro_ individuals into new ways of thinking about urban space and land usage in general with respect to “value”.

My initial reflex was to set up a system of constraints from which I could work, which required me to audit the materials given to me and determine the core of what FOAM was all about.

Shown in the Figma embed below, I arranged the screenshots I was provided in a spatial manner (with expected actions flowing from left to right) and I strung them together using Figma's prototyping functionality. I was left with a [rough sketch of an application](https://www.figma.com/proto/WL9J2gCvV3mg6Uo6WV5Rq2IN/1.-UX-Audit?node-id=1432%3A363&scaling=scale-down-width) I could click through and take notes on.

<iframe style="border: none;" src="https://www.figma.com/embed?embed_host=share&url=https%3A%2F%2Fwww.figma.com%2Ffile%2FWL9J2gCvV3mg6Uo6WV5Rq2IN%2F1.-UX-Sketching%3Fnode-id%3D1432%253A363" allowfullscreen></iframe>

I used this prototype and the notes I compiled as an artifact FOAM and I could rally around to communicate with one another what felt weird, neccessary, or unusable about the way the platform was initially communicated.

We came to an agreement that a form-based interface wasn't compelling, and given the spatial nature of where crypto-value was being held with FOAM, it made sense to bring forth the richness of space through an interactive map — an interface primitive most people have normalized and know how to use.

From this point, I began to develop high-level wireframes to structure the initial pass of the crypto map:

<iframe style="border: none;" src="https://www.figma.com/embed?embed_host=share&url=https%3A%2F%2Fwww.figma.com%2Ffile%2FWL9J2gCvV3mg6Uo6WV5Rq2IN%2F1.-UX-Audit%3Fnode-id%3D0%253A1" allowfullscreen></iframe>

My initial designs involved incorporating the bare minimum of general affordances most other mapping applications offered — a search mechanism, a means of panning and zooming and centering the map, a means of representing Points of Interest on the map, etc.

![]()

Where this work took an interesting turn was in the structuring of "crypto interfacing" that needed to co-inhabit the viewport; Where would this information live? Where did the blockchain need to be surfaced? _Does_ a blockchain need to be surfaced at all? Ever?
