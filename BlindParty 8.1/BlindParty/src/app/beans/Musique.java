/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package app.beans;

/**
 *
 * @author shine
 */
public class Musique {

    public Musique(String nom, Categories categorie, String refAudio, String refImage) {

        this.nom = nom;
        this.categorie = categorie;
        this.refAudio = "resources/sounds/" + refAudio;
        this.refImage = "resources/images/" + refImage;
    }
    
    public Musique(String nom, String refAudio, Categories categorie) {

        this.nom = nom;
        this.categorie = categorie;
        this.refAudio = "resources/sounds/" + refAudio;
        this.refImage = "resources/images/NoImage.png";
    }

    //Getters
    public String getNom() {
        return nom;
    }

    public String getFichierAudio() {
        return refAudio;
    }

    public Categories getCategorie() {
        return categorie;
    }
    
    public String getImage(){
        return refImage;
    }

    //Attributs
    private String nom;
    private String refAudio;
    private String refImage;
    private Categories categorie;

}
